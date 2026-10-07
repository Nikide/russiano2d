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

import { ctx, query } from './core.js';

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
// Подсистема
// ---------------------------------------------------------------------------

export function installCombat($) {
    /** Узел → модель здоровья. */
    const models = new WeakMap();

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
    };

    $.combat = combat;
    ctx.combat = combat;
    return combat;
}

/** Живые узлы реестра: нужны для тика крови. */
function liveNodes() {
    return ctx.nodes || [];
}
