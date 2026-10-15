// ===========================================================================
// Бой: здоровье по зонам, урон, кровь и броня — $.combat
//
// Порт из audm-neko (game/combat/limb_health.gd, damage_model.gd). Там здоровье
// было ОДНИМ числом до появления модели конечностей, а стало пятью зонами:
//
//   HEAD    35  — ноль = смерть
//   CHEST   85  — ноль = смерть
//   ARMS    60  — ноль = чёрная рука: тряска прицела, дольше перезарядка
//   STOMACH 70  — ноль = чёрный живот: тикает уроном, пока идёт кровь
//   LEGS    65  — ноль = чёрные ноги: скорость и прыжок режутся
//
// Парные конечности — ОДИН пул: хитбоксы разные, но игроку не надо помнить,
// какую руку задело. Это осознанное упрощение оригинала, и оно сохранено.
//
// Главное решение модели тоже сохранено: чёрную конечность ПОДНИМАЕТ аптечка,
// а не только хирургия — иначе игрок без хирургии встаёт в тупик.
//
//   const hp = $.combat.health();            // своя модель на бойца
//   hp.hit('chest', 40);                     // урон в грудь
//   hp.hit('arm', 30);                       // сильное попадание в руку
//   hp.tick(dt);                             // кровь тикает
//   hp.aimPenalty();                         // множитель тряски прицела
//   hp.heal('arm', 20);                      // аптечка поднимает и чёрное
//
// Боец игры связывается со здоровьем: `$.combat.attach('#hero')` — тогда урон
// из `hitNode()` сам уменьшает полоску здоровья узла и валит его при смерти.
//
// Ядро (createHealth, damageFor) не касается движка: зоны, кровь, броня и
// расчёт урона — чистые функции, проверяются юнит-тестом.
// ===========================================================================

import { ctx, query, engineOf } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: зоны и урон
// ---------------------------------------------------------------------------

/** Зоны по порядку; строки, чтобы состояние читалось в JSON. */
export const ZONES = ['head', 'chest', 'arms', 'stomach', 'legs'];

/** Максимум здоровья по зонам — числа оригинала. */
export const MAX_HP = {
    head: 35,
    chest: 85,
    arms: 60,
    stomach: 70,
    legs: 65,
};

/** Подписи зон для интерфейса. */
export const ZONE_TITLES = {
    head: 'Голова',
    chest: 'Грудь',
    arms: 'Руки',
    stomach: 'Живот',
    legs: 'Ноги',
};

/** Смертельные зоны: их ноль — конец, «чёрного» состояния у них нет. */
export const LETHAL = ['head', 'chest'];

/** Кровоточить могут только руки, живот и ноги. */
export const BLEEDABLE = ['arms', 'stomach', 'legs'];

/** Порог одного попадания, с которого начинается кровотечение. */
export const BLEED_THRESHOLD = 25;
/** Сколько HP в секунду теряет кровоточащая зона. */
export const BLEED_PER_SEC = 1;
/** Множители дебаффов чёрных конечностей. */
export const BLACKED = {
    aim: 1.6,      // сильнее тряска прицела
    reload: 1.4,   // дольше перезарядка
    speed: 0.45,   // медленнее бег
    jump: 0.5,     // ниже прыжок
};

/**
 * Добавка урона за попадание в часть тела (оригинал: голова +30, грудь +10).
 * Ключи — ИМЕНА ЗОН (`arms`, `legs`), потому что `damageFor` получает зону;
 * синонимы слотов (`arm`, `torso`) тоже принимаются, чтобы вызов по слоту не
 * терял добавку, — на этом и был баг: таблица была для слотов, а зовётся зонами.
 */
export const PART_DAMAGE = {
    head: 30,
    chest: 10,
    torso: 10,
    arms: 6,
    arm: 6,
    legs: 6,
    leg: 6,
    stomach: 6,
};

/**
 * Итоговый урон выстрела: (оружие + часть) × 1.35 — как в оригинале.
 * Оружие приходит от ствола, часть — из зоны попадания.
 */
export const DAMAGE_SCALE = 1.35;

export function damageFor(weaponDamage, zone) {
    const key = String(zone === undefined || zone === null ? '' : zone).toLowerCase();
    const part = PART_DAMAGE[key] === undefined ? PART_DAMAGE.chest : PART_DAMAGE[key];
    return Math.round((Math.max(0, Number(weaponDamage) || 0) + part) * DAMAGE_SCALE);
}

/**
 * Слот рига → зона. Игра отдаёт слот хитбокса (`arm_forearm_front`, `head`,
 * `torso`…), а модель знает только пять зон: неизвестное считаем грудью, как в
 * оригинале — лучше попасть, чем промахнуться в пустоту.
 */
export function zoneForSlot(slot) {
    const text = String(slot === undefined || slot === null ? '' : slot).toLowerCase();
    if (!text) return 'chest';
    if (text.startsWith('head') || text === 'neck') return 'head';
    if (text.startsWith('arm') || text.startsWith('hand') || text.startsWith('shoulder')) return 'arms';
    if (text.startsWith('leg') || text.startsWith('foot') || text.startsWith('thigh')
        || text.startsWith('shin')) return 'legs';
    if (text.startsWith('stomach') || text.startsWith('belly') || text === 'pelvis') return 'stomach';
    if (text.startsWith('torso') || text.startsWith('chest') || text.startsWith('body')) return 'chest';
    return 'chest';
}

/**
 * Доля урона, которую держит броня класса 1..6 (целая): 15%…70%.
 * Класс 0 — брони нет.
 */
export function armorBlock(armorClass) {
    const table = [0, 0.15, 0.25, 0.36, 0.47, 0.58, 0.7];
    const cls = Math.max(0, Math.min(6, Math.floor(Number(armorClass) || 0)));
    return table[cls];
}

/**
 * Урон после брони. Прочность тратится пропорционально попаданию, и защита
 * падает вместе с ней: целая броня держит 70%, убитая — ничего.
 */
export function applyArmor(amount, armorClass, durability, maxDurability) {
    const raw = Math.max(0, Number(amount) || 0);
    const block = armorBlock(armorClass);
    if (block <= 0) return { damage: raw, blocked: 0, spent: 0 };
    const max = Math.max(1, Number(maxDurability) || 100);
    const left = Math.max(0, Math.min(Number(durability) === undefined ? max : Number(durability), max));
    const wear = left / max;
    const effective = block * wear;
    const blocked = raw * effective;
    // Прочность тает от попадания: за 100 единиц брони — примерно 100 урона.
    const spent = Math.min(left, raw);
    return { damage: raw - blocked, blocked, spent };
}

// ---------------------------------------------------------------------------
// Чистое ядро: здоровье бойца
// ---------------------------------------------------------------------------

/**
 * Модель здоровья. `opts` — `{ onZone, onBlacked, onDeath, onBleedOut }` для
 * событий; в движке их связывает `attach()`.
 */
export function createHealth(opts) {
    const spec = opts || {};
    const max = Object.assign({}, MAX_HP, spec.max || {});
    const hp = {};
    const bleeding = {};
    for (const zone of ZONES) {
        hp[zone] = max[zone];
        bleeding[zone] = false;
    }
    let dead = false;
    let deathCause = null;
    let bleedAcc = 0;

    function emit(name, data) {
        const fn = spec[name];
        if (typeof fn === 'function') fn(data);
    }

    const state = {
        /** Максимум зоны. */
        maxOf(zone) { return max[String(zone)] || 0; },
        /** HP зоны. */
        get(zone) { return hp[String(zone)] || 0; },
        /** Все зоны: `{ head: 35, … }`. */
        all() { return Object.assign({}, hp); },

        /** Зона «чёрная» (ноль) и не смертельная. */
        blacked(zone) {
            const key = String(zone);
            return !LETHAL.includes(key) && hp[key] <= 0;
        },
        /** Все чёрные зоны. */
        blackedZones() { return ZONES.filter((z) => state.blacked(z)); },

        /** Кровоточит ли зона. */
        isBleeding(zone) { return !!bleeding[String(zone)]; },
        /** Есть ли кровотечение вообще. */
        bleeding() { return ZONES.filter((z) => bleeding[z]); },
        anyBleeding() { return state.bleeding().length > 0; },
        /** Идёт ли кровь в смертельных зонах — там её не бывает. */
        blackedCount() { return state.blackedZones().length; },

        /** Мёртв ли. */
        get dead() { return dead; },
        get deathCause() { return deathCause; },

        /**
         * Урон в зону. Возвращает `{ died, blacked, healed }` —
         * что произошло от этого попадания.
         */
        hit(zone, amount, info) {
            const key = String(zone);
            const result = { died: false, blacked: false, amount: 0, zone: key, blocked: 0 };
            if (dead || !(key in hp)) return result;
            const raw = Math.max(0, Number(amount) || 0);
            if (raw <= 0) return result;

            // Броня держит часть урона и тратится.
            const armor = info && info.armor;
            let damage = raw;
            if (armor && armor.class) {
                const applied = applyArmor(raw, armor.class, armor.durability, armor.maxDurability);
                damage = applied.damage;
                result.blocked = applied.blocked;
                if (typeof armor.spend === 'function') armor.spend(applied.spent);
            }
            result.amount = damage;

            const before = hp[key];
            hp[key] = Math.max(0, before - damage);
            emit('onZone', { zone: key, hp: hp[key], max: max[key], before, amount: damage });

            // Кровотечение: сильное попадание в руку, живот или ногу.
            if (BLEEDABLE.includes(key) && damage >= BLEED_THRESHOLD
                && hp[key] > 0 && !bleeding[key]) {
                bleeding[key] = true;
                emit('onBleed', { zone: key });
            }

            if (hp[key] <= 0) {
                if (LETHAL.includes(key)) {
                    if (!dead) {
                        dead = true;
                        deathCause = key;
                        result.died = true;
                        emit('onDeath', { cause: key });
                    }
                    return result;
                }
                if (before > 0) {
                    result.blacked = true;
                    emit('onBlacked', { zone: key });
                }
            }
            return result;
        },

        /**
         * Урон по слоту хитбокса: `hitSlot('arm_forearm_front', 30)`.
         * Слот переводится в зону, броня берётся из `info`.
         */
        hitSlot(slot, weaponDamage, info) {
            // Слот переводится в зону, и урон считается как выстрел:
            // (оружие + добавка за часть тела) × 1.35 — иначе попадание в руку
            // было бы ничем не выгоднее попадания в грудь.
            const zone = zoneForSlot(slot);
            return state.hit(zone, damageFor(weaponDamage, zone), info);
        },

        /** Тик крови: зона с кровью теряет HP, может почернеть или убить. */
        tick(dt) {
            const step = Math.max(0, Number(dt) || 0);
            if (dead || step <= 0) return null;
            bleedAcc += step;
            // Кровь считается мелкими шагами, чтобы не терять доли секунды.
            let events = 0;
            const steps = Math.floor(bleedAcc / 0.1);
            for (let i = 0; i < steps; ++i) {
                for (const zone of BLEEDABLE) {
                    if (!bleeding[zone] || hp[zone] <= 0) continue;
                    const before = hp[zone];
                    hp[zone] = Math.max(0, before - BLEED_PER_SEC * 0.1);
                    events++;
                    emit('onZone', { zone, hp: hp[zone], max: max[zone], before,
                                     amount: BLEED_PER_SEC * 0.1, bleed: true });
                    if (hp[zone] <= 0 && before > 0) emit('onBlacked', { zone });
                }
            }
            // Остаток времени переносится на следующий тик: иначе на 60 кадрах
            // терялось бы до 0.1 с крови каждый кадр.
            bleedAcc -= steps * 0.1;
            return { events, leftover: bleedAcc };
        },

        /**
         * Лечение зоны. Возвращает сколько вылечено. Поднимает и чёрную
         * конечность — это главное решение модели (см. заголовок файла).
         */
        heal(zone, amount) {
            const key = String(zone);
            if (dead || !(key in hp)) return 0;
            const want = Math.max(0, Number(amount) || 0);
            const room = max[key] - hp[key];
            const healed = Math.max(0, Math.min(room, want));
            hp[key] += healed;
            if (healed > 0) emit('onZone', { zone: key, hp: hp[key], max: max[key], amount: healed });
            return healed;
        },

        /** Остановить кровотечение во всех зонах: сколько зон остановлено. */
        stopBleeding() {
            let count = 0;
            for (const zone of BLEEDABLE) {
                if (bleeding[zone]) { bleeding[zone] = false; count++; }
            }
            return count;
        },

        /** Множитель тряски прицела: чёрные руки бьют по нему. */
        aimPenalty() { return state.blacked('arms') ? BLACKED.aim : 1; },
        /** Множитель времени перезарядки. */
        reloadPenalty() { return state.blacked('arms') ? BLACKED.reload : 1; },
        /** Множитель скорости. */
        speedMultiplier() { return state.blacked('legs') ? BLACKED.speed : 1; },
        /** Множитель прыжка. */
        jumpMultiplier() { return state.blacked('legs') ? BLACKED.jump : 1; },

        /**
         * Сумма по нелетальным зонам. В оригинале это «число для старых
         * потребителей current_health»: голова и грудь в него не входят, у них
         * своя цена (смерть).
         *
         * ВНИМАНИЕ: для полоски здоровья это НЕ подходит — попадание в грудь
         * не меняло бы её вовсе (так и вышло при проверке в движке). Полоска
         * использует `sum()`.
         */
        total() {
            let sum = 0;
            for (const zone of ZONES) if (!LETHAL.includes(zone)) sum += hp[zone];
            return sum;
        },

        /** Сумма по ВСЕМ зонам — это и есть полоска здоровья бойца. */
        sum() {
            let sum = 0;
            for (const zone of ZONES) sum += hp[zone];
            return sum;
        },

        /** Полный максимум по всем зонам. */
        sumMax() {
            let sum = 0;
            for (const zone of ZONES) sum += max[zone];
            return sum;
        },

        /** Полное здоровье в сумме — по всем зонам (для полоски). */
        totalMax() { return state.sumMax(); },

        /** Доля здоровья 0..1 для полоски — по всем зонам. */
        fraction() {
            const m = state.sumMax();
            return m > 0 ? state.sum() / m : 0;
        },

        /** Строка для отладки: «Голова 35/35, Грудь 45/85…». */
        report() {
            return ZONES.map((zone) => `${ZONE_TITLES[zone]} ${Math.round(hp[zone])}/${max[zone]}`
                + (state.blacked(zone) ? ' (чёрная)' : '')
                + (bleeding[zone] ? ' (кровь)' : '')).join(', ');
        },

        /** Оживить и восстановить всё (новая игра, респавн). */
        reset() {
            for (const zone of ZONES) { hp[zone] = max[zone]; bleeding[zone] = false; }
            dead = false;
            deathCause = null;
            bleedAcc = 0;
            return state;
        },

        /** Снимок для сейва. */
        save() {
            return { hp: Object.assign({}, hp), bleeding: Object.assign({}, bleeding),
                     dead, deathCause };
        },

        /** Восстановить из сейва. */
        load(data) {
            if (!data || typeof data !== 'object') return state;
            for (const zone of ZONES) {
                if (typeof data.hp?.[zone] === 'number') {
                    hp[zone] = Math.max(0, Math.min(data.hp[zone], max[zone]));
                }
                bleeding[zone] = !!data.bleeding?.[zone];
            }
            dead = !!data.dead;
            deathCause = data.deathCause || null;
            return state;
        },
    };

    return state;
}

// ---------------------------------------------------------------------------
// §9. Общий damage contract: атака → фильтр → урон → событие результата
//
// Зональная модель выше — опциональная надстройка. Здесь — общий контракт,
// которым пользуется и она, и обычная полоска node.cur_hp:
//
//   const atk = $.combat.attack({ source: '#hero', team: 1, window: 150,
//                                 amount: 20, rehit: 'once' });
//   const hits = $.combat.strike(atk, $('#sword').areaOverlap('blade'));
//
// Порядок обязателен: собрать кандидатов → отфильтровать и дедуплицировать →
// применить gameplay → выпустить событие результата → presentation. `$.hits`
// здесь не вызывается: это presentation, а не источник урона (§9).
//
// Ответ damage содержит ФАКТИЧЕСКУЮ причину отказа: inactive_window, immunity,
// team, duplicate, destroyed_target, owner_dead, zero_amount, unknown_target.
// ---------------------------------------------------------------------------

/** Порядок причин отказа — контракт; проверяется тестом. */
export const REFUSAL_REASONS = [
    'unknown_target', 'destroyed_target', 'inactive_window', 'owner_dead',
    'team', 'duplicate', 'immunity', 'zero_amount',
];

/**
 * Чистое решение фильтра: что ответить на damage request.
 *
 * `input`: `{ targetExists, targetRemoved, hp, iframes, teamMismatch, duplicate,
 *             attackActive, ownerAlive, amount }`.
 * Возвращает причину отказа или `null` — урон применяется.
 */
export function damageReason(input) {
    const i = input || {};
    if (i.targetExists === false) return 'unknown_target';
    if (i.targetRemoved === true || (Number(i.hp) || 0) <= 0) return 'destroyed_target';
    if (i.attackActive === false) return 'inactive_window';
    if (i.ownerAlive === false) return 'owner_dead';
    if (i.teamMismatch === true) return 'team';
    if (i.duplicate === true) return 'duplicate';
    if ((Number(i.iframes) || 0) > 0) return 'immunity';
    if (!(Number(i.amount) > 0)) return 'zero_amount';
    return null;
}

/**
 * Дедупликация повторных попаданий одной атаки.
 *
 * Ключ — логический владелец цели (nid), а не форма и не body: несколько
 * hurtbox одной цели дают ОДИН gameplay-hit. Политика:
 *   'once'   — одна цель один раз за всю атаку (умолчание);
 *   'window' — одна цель один раз за активное окно (то же, но с окном);
 *   'always' — каждая strike попадает, если не истёк hitCooldown.
 */
export function hitAllowed(attack, targetKey, now) {
    if (!attack) return { allowed: false, reason: 'inactive_window' };
    if (attack.cancelled) return { allowed: false, reason: 'inactive_window' };
    if (now > attack.until) return { allowed: false, reason: 'inactive_window' };
    const policy = attack.rehit || 'once';
    if (policy === 'always') {
        const last = attack.cooldown_until && attack.cooldown_until[targetKey];
        if (last !== undefined && now < last) return { allowed: false, reason: 'duplicate' };
        return { allowed: true, reason: null };
    }
    if (attack.hit_targets && attack.hit_targets[targetKey]) {
        return { allowed: false, reason: 'duplicate' };
    }
    return { allowed: true, reason: null };
}

/** Запомнить попадание (мутирует атаку — это её журнал). */
export function noteHit(attack, targetKey, now) {
    if (!attack) return;
    if (!attack.hit_targets) attack.hit_targets = {};
    attack.hit_targets[targetKey] = now;
    if ((attack.rehit || 'once') === 'always') {
        if (!attack.cooldown_until) attack.cooldown_until = {};
        // hit_cooldown задаётся в мс, время атаки — в секундах.
        attack.cooldown_until[targetKey] = now + (attack.hit_cooldown || 0) / 1000;
    }
}

/**
 * Политика отражения снаряда/атаки: создаётся НОВАЯ identity (новый id), у неё
 * новый владелец и команда, а старая помечается отражённой. Damage type и
 * множитель урона — по opts, потому что «отражённый вдвое сильнее» — правило
 * игры, а не движка.
 */
export function reflectAttack(spec, opts, makeId, now) {
    const o = opts || {};
    const src = spec || {};
    const out = {
        id: makeId(),
        source: o.source !== undefined ? o.source : src.source,
        owner: o.owner !== undefined ? o.owner : src.owner,
        team: o.team !== undefined ? o.team : src.team,
        attackId: src.id,
        reflected: true,
        reflectedFrom: src.id,
        damageType: o.damageType !== undefined ? o.damageType : src.damageType,
        amount: o.amount !== undefined ? o.amount : (src.amount || 0) * (o.multiplier === undefined ? 1 : o.multiplier),
        impulse: o.impulse !== undefined ? o.impulse : src.impulse,
        window: o.window !== undefined ? o.window : (src.window === undefined ? 150 : src.window),
        rehit: o.rehit !== undefined ? o.rehit : (src.rehit || 'once'),
        hit_cooldown: o.hitCooldown !== undefined ? o.hitCooldown : (src.hit_cooldown || 0),
        onOwnerDeath: o.onOwnerDeath !== undefined ? o.onOwnerDeath : 'cancel',
        until: now + (o.window !== undefined ? o.window : (src.window === undefined ? 150 : src.window)) / 1000,
        hit_targets: {},
    };
    if (src) src.reflectedBy = out.id;
    return out;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installCombat($) {
    /** Узел → модель здоровья. */
    const models = new WeakMap();
    /** §9: атаки этой сессии — identity и журнал попаданий. */
    const state = { next_id: 1, attacks: new Map(), nodes: new Map() };

    function nodeOf(what) {
        if (!what) return null;
        if (typeof what === 'string') return query(what)[0] || null;
        if (what.nodes) return what.nodes[0] || null;
        return what.tag ? what : null;
    }

    /** События модели ведут к полоске здоровья узла и его смерти. */
    function attach(what, opts) {
        const node = nodeOf(what);
        if (!node) { ctx.log('$.combat.attach: узел не найден'); return null; }
        if (models.has(node)) return models.get(node);
        const spec = opts || {};

        const health = createHealth({
            onZone: (info) => {
                // Полоска узла — сумма по ВСЕМ зонам: с нелетальными она не
                // двигалась от попадания в грудь (проверено в движке).
                node.max_hp = Math.max(1, health.sumMax());
                node.cur_hp = health.sum();
                if ($.signal) $.signal.emit('combat:zone', Object.assign({ node }, info));
            },
            onBlacked: (info) => {
                if ($.signal) $.signal.emit('combat:blacked', Object.assign({ node }, info));
            },
            onDeath: (info) => {
                if ($.signal) $.signal.emit('combat:died', Object.assign({ node }, info));
                if (typeof spec.onDeath === 'function') spec.onDeath(node, info);
            },
            onBleed: (info) => {
                if ($.signal) $.signal.emit('combat:bleed', Object.assign({ node }, info));
            },
        });
        models.set(node, health);
        // Начальная полоска: узлу сразу видно здоровье.
        node.max_hp = Math.max(1, health.sumMax());
        node.cur_hp = health.sum();
        return health;
    }

    const combat = {
        /** Модель здоровья по узлу, обёртке или селектору. */
        health(what) {
            if (what === undefined) return createHealth();
            const node = nodeOf(what);
            return node ? (models.get(node) || null) : null;
        },

        /** Новая модель (для тестов и своих бойцов). */
        createHealth,

        /** Связать узел со здоровьем: урон будет менять полоску узла. */
        attach,

        /** Отвязать (смерть, выход со сцены). */
        detach(what) {
            const node = nodeOf(what);
            return node ? models.delete(node) : false;
        },

        /** Зоны, максимумы и подписи — для интерфейса. */
        zones() { return ZONES.slice(); },
        titles() { return Object.assign({}, ZONE_TITLES); },
        maxHp() { return Object.assign({}, MAX_HP); },

        /** Урон по слоту хитбокса без привязки: `$.combat.damage(35, 'head')`. */
        damage(weaponDamage, slot) { return damageFor(weaponDamage, zoneForSlot(slot)); },

        /** Зона по слоту рига. */
        zoneForSlot,

        /** Итоговый урон оружия по зоне. */
        damageFor,

        /**
         * Выстрел по бойцу: `$.combat.hit('#enemy', 35, 'head', opts)`.
         * `opts.tick` — сколько секунд крови отсчитать сразу (обычно 0).
         */
        hit(what, weaponDamage, slot, opts) {
            const node = nodeOf(what);
            if (!node) return null;
            const health = models.get(node) || attach(node);
            const spec = opts || {};
            const zone = spec.zone === undefined ? zoneForSlot(slot) : String(spec.zone);
            const damage = spec.raw === undefined ? damageFor(weaponDamage, zone) : Number(spec.raw);
            const result = health.hit(zone, damage, { armor: spec.armor });
            if (spec.tick > 0) health.tick(spec.tick);
            return Object.assign({ zone, damage }, result);
        },

        /** Тик крови всем привязанным бойцам (зов ставится игрой). */
        tick(dt) { return combat.tickAll(dt); },

        /** Тик крови у всех привязанных бойцов: сколько моделей обновлено. */
        tickAll(dt) {
            let count = 0;
            for (const node of liveNodes()) {
                const health = models.get(node);
                if (!health) continue;
                if (!health.dead) health.tick(dt);
                count++;
            }
            return count;
        },

        // --- §9. Атаки и общий damage contract ------------------------------

        /**
         * Создать instance атаки: `$.combat.attack({ source, owner, team,
         * amount, damageType, window, rehit, hitCooldown, impulse, data })`.
         *
         * Возвращает данные атаки (обычный объект, не компонент): `id` — её
         * identity, `source_id`/`owner_id` — устойчивые логические ID, `until` —
         * конец активного окна в игровом времени. Пока окно открыто, атака
         * живёт в `$.combat.attacks()`.
         */
        attack(spec) {
            const s = spec || {};
            const now = gameNow();
            const src = nodeOf(s.source);
            const own = s.owner === undefined ? src : (nodeOf(s.owner) || src);
            const window = Math.max(0, Number(s.window) || 150);
            const atk = {
                id: state.next_id++,
                source_id: src ? src.nid : null,
                owner_id: own ? own.nid : null,
                team: s.team === undefined ? null : s.team,
                amount: Math.max(0, Number(s.amount) || 0),
                damageType: s.damageType === undefined ? 'default' : String(s.damageType),
                window,
                until: now + window / 1000,
                rehit: s.rehit || 'once',
                hit_cooldown: Math.max(0, Number(s.hitCooldown) || 0),
                onOwnerDeath: s.onOwnerDeath === 'continue' ? 'continue' : 'cancel',
                friendlyFire: !!s.friendlyFire,
                impulse: s.impulse || null,
                dir: s.dir || null,
                data: s.data || null,
                roles: Array.isArray(s.roles) ? s.roles.slice() : ['hurtbox', 'movement'],
                hit_targets: {},
                hits: [],
                cancelled: false,
            };
            state.attacks.set(atk.id, atk);
            // Ссылки на узлы держим ВНЕ объекта атаки: он уходит в JSON
            // (store/агент) и не должен тащить дерево узлов с циклами.
            state.nodes.set(atk.id, { source: src, owner: own });
            note('attack', src, { attack: atk.id, amount: atk.amount, window, team: atk.team });
            return atk;
        },

        /** Активные (не истёкшие и не отменённые) атаки — данные, без ссылок на узлы. */
        attacks() {
            return activeAttacks();
        },

        /** Закрыть атаку: дальше она не попадает (reason inactive_window). */
        endAttack(attack) {
            const atk = attackOf(attack);
            if (!atk) return false;
            atk.cancelled = true;
            state.attacks.delete(atk.id);
            state.nodes.delete(atk.id);
            return true;
        },

        /**
         * Отразить снаряд/атаку: НОВАЯ identity, новый владелец и команда.
         * Политика — в opts: `{ source, owner, team, amount|multiplier,
         * damageType, impulse, window, onOwnerDeath }`. Старая атака помечается
         * `reflectedBy`.
         */
        reflect(attack, opts) {
            const atk = attackOf(attack);
            if (!atk) return null;
            const out = reflectAttack(atk, opts || {}, () => state.next_id++, gameNow());
            // Ссылки на узлы — по nid: политика отражения задаёт ID, а не handle.
            const srcNode = nodeOf(out.source);
            const ownNode = nodeOf(out.owner) || srcNode;
            // Устойчивые логические ID: игра и трассировка читают их, а не
            // нативные handle (у отражённой атаки владелец/команда новые).
            out.source_id = srcNode ? srcNode.nid : null;
            out.owner_id = ownNode ? ownNode.nid : null;
            state.attacks.set(out.id, out);
            state.nodes.set(out.id, { source: srcNode, owner: ownNode });
            note('reflect', ownNode, { attack: out.id, from: atk.id });
            return out;
        },

        /**
         * Один damage request: `$.combat.damageRequest({ amount, damageType,
         * source, target, attackId, dir, impulse, data })`.
         *
         * Ответ: `{ accepted, reason, applied, blocked, hpBefore, hpAfter, death,
         * zone, attackId, source_id, target_id, damageType, area, role }`.
         * Причина отказа фактическая (см. REFUSAL_REASONS).
         */
        damageRequest(request) {
            const r = request || {};
            const target = nodeOf(r.target);
            const source = nodeOf(r.source);
            const atk = r.attack !== undefined ? attackOf(r.attack)
                      : (r.attackId !== undefined ? state.attacks.get(r.attackId) : null);
            const now = gameNow();
            const transient = atk || {
                id: null,
                source_id: source ? source.nid : null,
                owner_id: source ? source.nid : null,
                team: r.team === undefined ? null : r.team,
                amount: Math.max(0, Number(r.amount) || 0),
                damageType: r.damageType === undefined ? 'default' : String(r.damageType),
                rehit: 'always', until: Infinity, hit_cooldown: 0,
                onOwnerDeath: 'continue', friendlyFire: !!r.friendlyFire,
                impulse: r.impulse || null, dir: r.dir || null, data: r.data || null,
                roles: ['hurtbox', 'movement'], hit_targets: {}, hits: [], cancelled: false,
            };
            return applyDamage(transient, target, target, r, now);
        },

        /**
         * Удар атакой по кандидатам: собрать → отфильтровать и дедуплицировать →
         * применить → событие результата. Кандидаты — результат
         * `.areaOverlap()`/`$.world.overlap*()` или узел/обёртка/массив.
         *
         * Возвращает `{ attackId, accepted, rejected, results }`: у одной цели с
         * несколькими hurtbox — ОДИН результат.
         */
        strike(attack, candidates, opts) {
            const atk = attackOf(attack);
            const out = { attackId: atk ? atk.id : null, accepted: 0, rejected: 0, results: [] };
            if (!atk) return out;
            if (atk.cancelled || gameNow() > atk.until) {
                out.reason = 'inactive_window';
                return out;
            }
            const list = candidateList(candidates);
            const seen = {};
            const filtered = opts || {};
            const roleFilter = Array.isArray(filtered.roles) ? filtered.roles : null;
            for (let i = 0; i < list.length; i++) {
                const c = list[i];
                const target = c.node;
                if (!target) continue;
                const owner = c.owner || target;
                // `role` кандидата — это роль ЗАПРОШЕННОЙ области (hitbox), а не
                // цель; фильтровать по ней по умолчанию нельзя, иначе удар не
                // находил бы hurtbox. Явный фильтр — `strike(atk, cands,
                // { roles: ['hurtbox'] })`; кандидат может нести `targetRole`.
                const role = c.targetRole === undefined
                    ? (c.role === undefined ? null : String(c.role)) : String(c.targetRole);
                if (roleFilter && role && roleFilter.indexOf(role) < 0) continue;
                const key = `${owner.nid}`;
                if (seen[key]) continue;   // несколько hurtbox одной цели — один удар
                seen[key] = true;
                const r = applyDamage(atk, target, owner, {
                    role, area: c.area || null,
                    zone: filtered.zone, armor: filtered.armor,
                    dir: c.dir || filtered.dir, impulse: filtered.impulse,
                }, gameNow());
                out.results.push(r);
                if (r.accepted) out.accepted++; else out.rejected++;
            }
            const atkSource = sourceOf(atk.id);
            if (out.accepted > 0 && atkSource) {
                atkSource.emit('attackHit', { attack: atk.id, results: out.results });
            }
            return out;
        },

        /** Причины отказа — для интерфейса и тестов. */
        refusalReasons() { return REFUSAL_REASONS.slice(); },
    };

    $.combat = combat;
    ctx.combat = combat;
    return combat;

    // --- §9: служебное (внутри installCombat, чтобы видеть models/attach) ----

    /** Время игры в секундах; без $.time (юнит-тест) — 0. */
    function gameNow() {
        return ctx.time && typeof ctx.time.now === 'function' ? ctx.time.now() : 0;
    }

    /** Запись в журнал $.trace: цепочка attack → damage → death (§28). */
    function note(kind, node, data) {
        if ($.trace && typeof $.trace.note === 'function') $.trace.note(kind, node, data);
    }

    /** Владелец/источник атаки по её id: узлы живут ВНЕ данных атаки, чтобы её
     *  объект спокойно уходил в JSON (store/агент) без циклов дерева узлов. */
    function ownerOf(id) {
        const e = state.nodes.get(id);
        return e ? (e.owner || e.source) : null;
    }

    function sourceOf(id) {
        const e = state.nodes.get(id);
        return e ? e.source : null;
    }

    /** Атака по объекту или по id. */
    function attackOf(what) {
        if (!what) return null;
        if (typeof what === 'number') return state.attacks.get(what) || null;
        return what.id !== undefined && what.until !== undefined ? what : null;
    }

    function activeAttacks() {
        const now = gameNow();
        const out = [];
        for (const atk of state.attacks.values()) {
            if (atk.cancelled) continue;
            out.push({
                id: atk.id, source_id: atk.source_id, owner_id: atk.owner_id,
                team: atk.team, amount: atk.amount, damageType: atk.damageType,
                window: atk.window, until: atk.until, active: now <= atk.until,
                rehit: atk.rehit, hits: atk.hits.length, reflected: !!atk.reflected,
                reflectedFrom: atk.reflectedFrom === undefined ? null : atk.reflectedFrom,
            });
        }
        return out;
    }

    /** Кандидаты удара → единый список `{ node, owner, role, area }`. */
    function candidateList(candidates) {
        if (!candidates) return [];
        // Кандидат приходит из `.areaOverlap()` обёртками (`{ node, owner,
        // area, role }`) — разворачиваем их в узлы: дедупликация и урон
        // работают с логическими владельцами, а не с обёртками.
        if (Array.isArray(candidates)) {
            const out = [];
            for (let i = 0; i < candidates.length; i++) {
                const c = candidates[i];
                if (!c) continue;
                const node = nodeOf(c.node !== undefined ? c.node : c);
                if (!node) continue;
                out.push({
                    node,
                    owner: nodeOf(c.owner) || node,
                    role: c.role === undefined ? null : c.role,
                    area: c.area === undefined ? null : c.area,
                    dir: c.dir,
                });
            }
            return out;
        }
        if (candidates.nodes) {
            return candidates.nodes.map((n) => ({ node: n, owner: n, role: null, area: null }));
        }
        const one = nodeOf(candidates);
        return one ? [{ node: one, owner: one, role: null, area: null }] : [];
    }

    /**
     * Применить урон: фильтр → gameplay → событие результата. Возвращает ответ
     * с ФАКТИЧЕСКОЙ причиной отказа. Presentation ($.hits) здесь не вызывается.
     */
    function applyDamage(atk, target, owner, extra, now) {
        const o = extra || {};
        const time = now === undefined ? gameNow() : now;
        const response = {
            accepted: false, reason: null,
            attackId: atk.id,
            source_id: atk.source_id,
            target_id: owner ? owner.nid : null,
            targetNodeId: target ? target.nid : null,
            amount: atk.amount,
            applied: 0, blocked: 0, hpBefore: 0, hpAfter: 0,
            death: false, zone: null, damageType: atk.damageType,
            area: o.area || null, role: o.role || null,
        };

        const health = target ? models.get(target) || null : null;
        const hp = target ? (health ? health.sum() : (Number(target.cur_hp) || 0)) : 0;
        const ownerNode = ownerOf(atk.id);
        const ownerAlive = !ownerNode || (!ownerNode.removed && ownerNode.cur_hp > 0);

        // Правило смерти владельца: явное, а не «как получилось».
        if (!ownerAlive && atk.onOwnerDeath === 'cancel') atk.cancelled = true;

        const hit = hitAllowed(atk, owner ? owner.nid : (target ? target.nid : -1), time);
        const reason = damageReason({
            targetExists: !!target,
            targetRemoved: !!(target && target.removed),
            hp,
            iframes: target ? (target.iframes || 0) : 0,
            teamMismatch: teamMismatch(atk, target),
            duplicate: !hit.allowed && hit.reason === 'duplicate',
            attackActive: hit.reason !== 'inactive_window',
            ownerAlive,
            amount: atk.amount,
        });
        if (reason) {
            response.reason = reason;
            note('damage', target, { attack: atk.id, accepted: false, reason });
            if (target && typeof target.emit === 'function') {
                try { target.emit('damage', response); } catch (e) { /* игра не должна ронять бой */ }
            }
            return response;
        }

        response.accepted = true;
        response.hpBefore = hp;
        if (health) {
            const zone = o.zone || (atk.data && atk.data.zone) || zoneForSlot(o.role || '');
            const result = health.hit(zone, atk.amount, { armor: o.armor });
            response.zone = zone;
            response.applied = result.amount;
            response.blocked = result.blocked;
            response.hpAfter = health.sum();
            response.death = !!result.died;
        } else {
            const applied = Math.max(0, Math.min(hp, atk.amount));
            response.applied = applied;
            response.hpAfter = hp - applied;
            target.cur_hp = response.hpAfter;
            response.death = hp > 0 && response.hpAfter <= 0;
            if (response.death) {
                // Единый путь смерти — событие узла; повторный урон по мёртвому
                // уже отсекается фильтром (destroyed_target).
                response.hpAfter = 0;
                target.cur_hp = 0;
            }
        }
        if (target) target.iframes = target.iframes || 0;

        noteHit(atk, owner ? owner.nid : (target ? target.nid : -1), time);
        atk.hits.push({
            target_id: response.target_id, applied: response.applied,
            death: response.death, zone: response.zone, at: time,
        });
        note('damage', target, {
            attack: atk.id, accepted: true, applied: response.applied,
            hpAfter: response.hpAfter, death: response.death, zone: response.zone,
        });
        if (response.death) note('death', target, { attack: atk.id, source: atk.source_id });

        // Импульс — физическое отбрасывание, а не косметический сдвиг: скорость
        // идёт через канал внешней скорости (§8), поэтому .controls() его не
        // стирает в следующем тике.
        const impulse = o.impulse || atk.impulse;
        if (target && impulse && !(target.removed)) {
            applyImpulseTo(target, impulse, atk.dir || o.dir);
        }

        if (target && typeof target.emit === 'function') {
            try { target.emit('damage', response); } catch (e) { /* см. выше */ }
        }
        return response;
    }

    /** Команда: свои не бьют своих, если игра не разрешила friendly fire. */
    function teamMismatch(atk, target) {
        if (atk.friendlyFire || !target) return false;
        if (atk.team === null || atk.team === undefined) return false;
        if (target.team === undefined || target.team === null) return false;
        return Number(target.team) === Number(atk.team);
    }

    /** Физический импульс: телу — Box2D, узлу без тела — через внешнюю скорость. */
    function applyImpulseTo(target, impulse, dir) {
        const ix = typeof impulse === 'object' ? (Number(impulse.x) || 0) : (Number(impulse) || 0);
        const iy = typeof impulse === 'object' ? (Number(impulse.y) || 0) : 0;
        const dx = dir ? (Number(dir.x) || 0) : 1;
        const dy = dir ? (Number(dir.y) || 0) : 0;
        const fx = ix !== 0 || iy !== 0 ? ix : dx * (Number(impulse) || 0);
        const fy = ix !== 0 || iy !== 0 ? iy : dy * (Number(impulse) || 0);
        if (target.body >= 0 && typeof engineOf().applyImpulse === 'function') {
            engineOf().applyImpulse(target.body, fx, fy);
        }
        // Внешняя скорость (§8): то же намерение в px/с, чтобы .controls() не
        // стёр его в следующем тике. У узла без тела это единственный канал —
        // косметический сдвиг сквозь стены не делаем.
        const ms = 120;
        target.ext_vel = {
            x: (target.ext_vel ? target.ext_vel.x : 0) + fx,
            y: (target.ext_vel ? target.ext_vel.y : 0) + fy,
            ms: ms / 1000, left: ms / 1000,
            applied_y: target.ext_vel ? target.ext_vel.applied_y : 0,
        };
    }
}

/** Живые узлы реестра: нужны для тика крови. */
function liveNodes() {
    return ctx.nodes || [];
}
