// ===========================================================================
// Оружие и баллистика — $.weapons
//
// Порт из audm-neko (game/weapons/weapon_db.gd, base_weapon_v2.gd,
// weapon_mods.gd, weapon_feel.gd). В оригинале стволы жили в одной базе
// (`WeaponDB.DB`), а рантайм-состояние — в BaseWeaponV2: магазин, темп, отдача,
// разброс, перезарядка по стилю и навесное, которое меняет характеристики.
//
//   $.weapons.define({
//       id: 'ak', name: 'АК', damage: 35, rpm: 600, ammo: 30, reload: 2.4,
//       spread: 1.4, recoil: 1.1, style: 'magazine', modes: ['auto', 'single'],
//   });
//   $.weapons.mod('muzzle', { id: 'brake', spread: 0.7, recoil: 0.85, slot: 'muzzle' });
//
//   const gun = $.weapons.create('ak');
//   gun.attach('brake');
//   gun.fire();              // выстрел: { fired, ammo, spread, recoil }
//   gun.reload();            // начать перезарядку
//   gun.tick(dt);            // темп, перезарядка, остывание отдачи
//   gun.stats();             // итоговые характеристики с навесным
//
// Что перенесено из оригинала:
//   * магазин и патрон в патроннике, перезарядка по времени (дробовик заряжается
//     по одному патрону — `style: 'shells'`);
//   * темп (RPM) и режимы (авто, одиночный, очередь);
//   * разброс и отдача, которые растут от стрельбы и остывают;
//   * навесное в слотах, которое множит и складывает характеристики;
//   * затухание урона по расстоянию и бронепробитие.
//
// Ядро (createWeapons, normalizeWeapon, combineStats, falloff) не касается
// движка: магазин, темп, моды и баллистика — чистые функции, их проверяет
// юнит-тест (tests/js/weapons_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: характеристики
// ---------------------------------------------------------------------------

/** Поля, которые навесное может множить (умножается) или складывать. */
export const MULT_FIELDS = ['damage', 'spread', 'recoil', 'rpm', 'reload', 'velocity',
                            'falloff', 'ammo'];
export const ADD_FIELDS = ['pellets', 'penetration'];

/** Нормализовать описание ствола. */
export function normalizeWeapon(raw) {
    if (!raw || !raw.id) return null;
    const modes = Array.isArray(raw.modes) && raw.modes.length
        ? raw.modes.map((m) => String(m))
        : ['single'];
    return {
        id: String(raw.id),
        name: raw.name || String(raw.id),
        kind: raw.kind === 'melee' ? 'melee' : 'gun',
        damage: Math.max(0, Number(raw.damage) || 0),
        rpm: Math.max(1, Number(raw.rpm) || 600),
        ammo: Math.max(0, Math.floor(Number(raw.ammo) || 0)),
        reload: Math.max(0, Number(raw.reload) || 2),
        spread: Math.max(0, Number(raw.spread) || 0),
        recoil: Math.max(0, Number(raw.recoil) || 0),
        velocity: Math.max(1, Number(raw.velocity) || 900),
        falloff: Math.max(0, Number(raw.falloff) || 0),
        penetration: Math.max(0, Number(raw.penetration) || 0),
        pellets: Math.max(1, Math.floor(Number(raw.pellets) || 1)),
        style: String(raw.style || (raw.kind === 'melee' ? 'none' : 'magazine')),
        modes,
        burst: Math.max(1, Math.floor(Number(raw.burst) || 3)),
        slots: Array.isArray(raw.slots) ? raw.slots.map(String) : ['muzzle', 'grip', 'mag', 'optic'],
        ammoType: raw.ammoType === undefined ? '' : String(raw.ammoType),
        sound: raw.sound === undefined ? '' : String(raw.sound),
        sprite: raw.sprite === undefined ? '' : String(raw.sprite),
        icon: raw.icon === undefined ? '' : String(raw.icon),
    };
}

/** Нормализовать навесное: слот, множители и добавки. */
export function normalizeMod(raw) {
    if (!raw || !raw.id) return null;
    const mult = {};
    const add = {};
    for (const field of MULT_FIELDS) {
        const value = Number(raw[field]);
        if (Number.isFinite(value) && value !== 0) mult[field] = value;
    }
    for (const field of ADD_FIELDS) {
        const value = Number(raw[field]);
        if (Number.isFinite(value) && value !== 0) add[field] = value;
    }
    return {
        id: String(raw.id),
        name: raw.name || String(raw.id),
        slot: String(raw.slot || 'muzzle'),
        mult,
        add,
        // Вес и цена — для инвентаря и торговца.
        mass: Math.max(0, Number(raw.mass) || 0),
        value: Math.max(0, Number(raw.value) || 0),
    };
}

/**
 * Итоговые характеристики: базовые × моды + добавки.
 * `mods` — массив нормализованного навесного (или его описаний).
 */
export function combineStats(base, mods) {
    const stats = Object.assign({}, base);
    const list = mods || [];
    for (const mod of list) {
        if (!mod) continue;
        const mult = mod.mult || {};
        const add = mod.add || {};
        for (const field of MULT_FIELDS) {
            if (mult[field] === undefined) continue;
            if (typeof stats[field] === 'number') stats[field] *= mult[field];
        }
        for (const field of ADD_FIELDS) {
            if (add[field] === undefined) continue;
            if (typeof stats[field] === 'number') stats[field] += add[field];
        }
    }
    // Округления: магазин целый, характеристики не отрицательные.
    stats.ammo = Math.max(0, Math.floor(stats.ammo));
    stats.pellets = Math.max(1, Math.floor(stats.pellets));
    stats.rpm = Math.max(1, stats.rpm);
    stats.reload = Math.max(0, stats.reload);
    stats.spread = Math.max(0, stats.spread);
    stats.recoil = Math.max(0, stats.recoil);
    stats.damage = Math.max(0, stats.damage);
    stats.penetration = Math.max(0, stats.penetration);
    return stats;
}

/**
 * Затухание урона по расстоянию: до `falloff` — полный урон, дальше падает до
 * 40% на удвоенной дистанции. Урон не обнуляется: попадание всегда больно.
 */
export function falloff(damage, distance, falloffStart) {
    const start = Math.max(0, Number(falloffStart) || 0);
    const d = Math.max(0, Number(distance) || 0);
    if (start <= 0 || d <= start) return Math.max(0, Number(damage) || 0);
    const over = (d - start) / start;
    const k = Math.max(0.4, 1 - over * 0.6);
    return Math.max(0, Number(damage) || 0) * k;
}

/** Сколько урона проходит сквозь броню: бронепробитие снижает её защиту. */
export function penetrationAgainst(penetration, armorClass) {
    const pen = Math.max(0, Number(penetration) || 0);
    const cls = Math.max(0, Math.min(6, Number(armorClass) || 0));
    if (cls <= 0) return cls;
    // Каждое очко пробития снимает примерно один класс брони.
    return Math.max(0, cls - Math.floor(pen));
}

/**
 * Разброс одного выстрела: базовый разброс плюс накопленная отдача, в градусах.
 * `heat` — 0..1 текущий перегрев от стрельбы.
 */
export function spreadFor(spread, recoil, heat) {
    const base = Math.max(0, Number(spread) || 0);
    const h = Math.max(0, Math.min(1, Number(heat) || 0));
    return base * (1 + h * 2) + Math.max(0, Number(recoil) || 0) * h;
}

// ---------------------------------------------------------------------------
// Чистое ядро: ствол в руках
// ---------------------------------------------------------------------------

/**
 * Создать ствол. `opts`: `{ defs, mods }` — база описаний и навесного.
 * Состояние: магазин, патрон в патроннике, таймеры, перегрев и отдача.
 */
export function createWeapon(id, opts) {
    const spec = opts || {};
    const defs = spec.defs || null;
    const mods = spec.mods || null;
    /** Достаёт мод и из базы (`get`), и из обычной карты. */
    function lookupMod(key) {
        if (!mods) return null;
        if (typeof mods.get === 'function') {
            const found = mods.get(String(key));
            if (found) return found;
        }
        const raw = mods[String(key)];
        return raw ? (raw.mult === undefined ? normalizeMod(raw) : raw) : null;
    }
    const raw = defs ? defs.get(id) : null;
    // Ствол или берётся из базы, или описывается прямо здесь. Без базы и без
    // описания создавать нечего — прежняя версия делала «ствол» из пустого
    // объекта, и вызывающий получал оружие там, где ждал null.
    if (!raw && (!id || typeof id !== 'object' || !id.id)) return null;
    const base = raw || normalizeWeapon(id);
    if (!base) return null;

    const modList = [];        // надетое навесное (нормализованное)
    let stats = combineStats(base, modList);
    let ammo = stats.ammo;     // патронов в магазине
    let chambered = base.style === 'shells' || base.style === 'break' ? 0 : (stats.ammo > 0 ? 1 : 0);
    // В магазине считаем ВСЕ патроны (включая патронник) — так проще для игры.
    let magazine = stats.ammo;
    let cooldown = 0;          // до следующего выстрела
    let reloading = 0;         // остаток перезарядки
    let reloadLeft = 0;        // сколько патронов дозарядить (shells)
    let shellTimer = 0;        // таймер одного патрона (shells)
    let heat = 0;              // перегрев 0..1 (растёт от стрельбы)
    let recoilAcc = 0;         // накопленная отдача
    let mode = stats.modes[0];
    let burstLeft = 0;
    let shots = 0;
    let lastKind = null;

    function recompute() {
        stats = combineStats(base, modList);
        // Магазин не может быть больше нового предела (сняли большой магазин —
        // лишние патроны теряются, как и в игре).
        if (magazine > stats.ammo) magazine = stats.ammo;
    }

    const weapon = {
        id: base.id,
        get name() { return stats.name; },
        get stats() { return Object.assign({}, stats); },
        get magazine() { return magazine; },
        get ammo() { return magazine; },
        get capacity() { return stats.ammo; },
        get reloading() { return reloading > 0; },
        get reloadLeft() { return reloading; },
        get heat() { return heat; },
        get recoilAccumulated() { return recoilAcc; },
        get shots() { return shots; },
        get lastShot() { return lastKind; },

        /** Текущий режим огня. */
        get mode() { return mode; },
        set mode(value) {
            const wanted = String(value);
            if (stats.modes.includes(wanted)) mode = wanted;
            else ctx.log(`$.weapons: у "${base.id}" нет режима "${value}"`);
        },

        /** Переключить режим по кругу. */
        cycleMode() {
            const list = stats.modes;
            const at = list.indexOf(mode);
            mode = list[(at + 1) % list.length];
            return mode;
        },

        /** Надетое навесное: `[{ id, slot }]`. */
        mods() { return modList.map((m) => ({ id: m.id, slot: m.slot })); },

        /**
         * Надеть навесное. Заменяет то, что стоит в том же слоте.
         * Возвращает снятый мод или null.
         */
        attach(mod) {
            const normalized = typeof mod === 'string' ? lookupMod(mod) : normalizeMod(mod);
            if (!normalized) { ctx.log(`$.weapons: нет навесного "${mod}"`); return null; }
            if (!stats.slots.includes(normalized.slot)) {
                ctx.log(`$.weapons: у "${base.id}" нет слота "${normalized.slot}"`);
                return null;
            }
            const at = modList.findIndex((m) => m.slot === normalized.slot);
            const previous = at >= 0 ? modList[at] : null;
            if (at >= 0) modList.splice(at, 1);
            modList.push(normalized);
            recompute();
            return previous ? previous.id : null;
        },

        /** Снять навесное из слота (или всё, если слот не указан). */
        detach(slot) {
            if (slot === undefined) {
                const ids = modList.map((m) => m.id);
                modList.length = 0;
                recompute();
                return ids;
            }
            const at = modList.findIndex((m) => m.slot === String(slot));
            if (at < 0) return null;
            const removed = modList[at].id;
            modList.splice(at, 1);
            recompute();
            return removed;
        },

        /** Полный магазин и сброс состояния (новая игра, подбор ствола). */
        reset(full) {
            magazine = full === false ? 0 : stats.ammo;
            cooldown = 0;
            reloading = 0;
            reloadLeft = 0;
            heat = 0;
            recoilAcc = 0;
            burstLeft = 0;
            return weapon;
        },

        /** Дозарядить магазин (подбор патронов вне перезарядки). */
        load(count) {
            const put = Math.max(0, Math.min(stats.ammo - magazine, Math.floor(Number(count) || 0)));
            magazine += put;
            return put;
        },

        /**
         * Выстрел: `fire({ heat?, burst? })`. Возвращает
         * `{ fired, reason, ammo, damage, spread, recoil, pellets, velocity }`.
         */
        fire(opts) {
            const o = opts || {};
            if (stats.kind === 'melee') {
                shots++;
                lastKind = { melee: true, time: ctx.time ? ctx.time.now() : 0 };
                return { fired: true, reason: 'melee', ammo: magazine, damage: stats.damage,
                         spread: 0, recoil: 0, pellets: 1, velocity: 0 };
            }
            if (reloading > 0) return { fired: false, reason: 'reloading', ammo: magazine };
            if (cooldown > 0) return { fired: false, reason: 'cooldown', ammo: magazine };
            if (burstLeft > 0) {
                // Продолжение очереди: режим не проверяем, темп держим.
            } else if (mode === 'burst') {
                burstLeft = stats.burst;
            } else if (mode === 'single' && shots > 0 && o.again !== true) {
                // Одиночный: на одно нажатие — один выстрел.
                if (o.held) return { fired: false, reason: 'single', ammo: magazine };
            }
            if (magazine <= 0) {
                return { fired: false, reason: 'empty', ammo: 0 };
            }

            magazine--;
            shots++;
            const wasBurst = burstLeft > 0;
            if (wasBurst) burstLeft--;
            else if (mode === 'burst') burstLeft = stats.burst - 1;
            cooldown = 60 / stats.rpm;
            burstLeft = Math.max(0, burstLeft);

            const currentSpread = spreadFor(stats.spread, stats.recoil, heat);
            const currentRecoil = stats.recoil * (1 + heat);
            heat = Math.min(1, heat + Math.max(0, Number(o.heat) || 0.12));
            recoilAcc += currentRecoil;

            lastKind = {
                time: ctx.time ? ctx.time.now() : 0,
                spread: currentSpread,
                recoil: currentRecoil,
                damage: stats.damage,
            };
            return {
                fired: true,
                reason: 'fired',
                ammo: magazine,
                damage: stats.damage,
                spread: currentSpread,
                recoil: currentRecoil,
                pellets: stats.pellets,
                velocity: stats.velocity,
                penetration: stats.penetration,
                falloff: stats.falloff,
            };
        },

        /**
         * Начать перезарядку. Возвращает false, если нечего или уже идёт.
         * `style: 'shells'` заряжает по одному патрону — см. tick().
         */
        reload(withAmmo) {
            if (reloading > 0) return false;
            if (magazine >= stats.ammo) return false;
            if (stats.style === 'none') return false;
            reloading = stats.reload;
            reloadLeft = stats.ammo - magazine;
            // Дробовик заряжается по одному патрону: таймер считает время
            // ОДНОГО патрона, а не всей перезарядки.
            shellTimer = stats.style === 'shells'
                ? stats.reload / Math.max(1, reloadLeft)
                : 0;
            // Внешний запас патронов: если игра передала число, дозаряжаем
            // столько, сколько есть.
            if (withAmmo !== undefined) {
                reloadLeft = Math.min(reloadLeft, Math.max(0, Math.floor(Number(withAmmo) || 0)));
            }
            return true;
        },

        /** Прервать перезарядку (спринт, удар). */
        cancelReload() {
            if (reloading <= 0) return false;
            reloading = 0;
            reloadLeft = 0;
            return true;
        },

        /** Отдача остывает, перегрев спадает. */
        tick(dt) {
            const step = Math.max(0, Number(dt) || 0);
            if (step <= 0) return weapon;
            if (cooldown > 0) cooldown = Math.max(0, cooldown - step);
            if (heat > 0) heat = Math.max(0, heat - step * 0.8);
            if (recoilAcc > 0) recoilAcc = Math.max(0, recoilAcc - step * 2.5);

            if (reloading > 0) {
                reloading = Math.max(0, reloading - step);
                if (stats.style === 'shells') {
                    // Дробовик: патрон за патроном по своему таймеру. Прежняя
                    // версия пыталась дополнить остаток в том же кадре: при
                    // длинном кадре патроны терялись, при коротком — не
                    // заряжались вовсе.
                    shellTimer -= step;
                    let put = 0;
                    while (shellTimer <= 0 && reloadLeft > 0) {
                        magazine++;
                        reloadLeft--;
                        put++;
                        shellTimer += stats.reload / Math.max(1, reloadLeft + put);
                    }
                    if (put > 0) lastKind = { shell: put };
                    if (reloadLeft <= 0) reloading = 0;
                } else if (reloading <= 0) {
                    magazine = Math.min(stats.ammo, magazine + reloadLeft);
                    reloadLeft = 0;
                }
            }
            return weapon;
        },

        /** Урон на расстоянии с затуханием. */
        damageAt(distance) { return falloff(stats.damage, distance, stats.falloff); },

        /** Событие выстрела для звука и вспышки: `{ spread, recoil, empty }`. */
        report() {
            return {
                id: base.id,
                mode,
                magazine,
                capacity: stats.ammo,
                reloading: reloading > 0,
                reloadLeft: reloading,
                heat,
                recoil: recoilAcc,
                shots,
            };
        },

        /** Снимок для сейва: магазин и навесное. */
        save() {
            return { id: base.id, magazine, mods: modList.map((m) => m.id), mode };
        },

        /** Восстановить из сейва. */
        load2(data) {
            if (!data || typeof data !== 'object') return weapon;
            modList.length = 0;
            for (const modId of data.mods || []) {
                const normalized = lookupMod(modId);
                if (normalized && base.slots.includes(normalized.slot)) modList.push(normalized);
            }
            recompute();
            magazine = Math.max(0, Math.min(Number(data.magazine) || 0, stats.ammo));
            if (data.mode && stats.modes.includes(data.mode)) mode = data.mode;
            reloading = 0;
            reloadLeft = 0;
            return weapon;
        },
    };

    // Патрон в патроннике: у дробовика и «переломки» магазин пуст до перезарядки.
    void chambered;
    return weapon;
}

// ---------------------------------------------------------------------------
// Чистое ядро: база стволов и навесного
// ---------------------------------------------------------------------------

export function createWeapons() {
    const guns = new Map();
    const mods = new Map();

    const db = {
        /** Описать ствол. */
        define(raw) {
            const weapon = normalizeWeapon(raw);
            if (!weapon) { ctx.log('$.weapons.define: нужно поле id'); return null; }
            guns.set(weapon.id, weapon);
            return weapon;
        },

        /** Описать навесное. */
        defineMod(raw) {
            const mod = normalizeMod(raw);
            if (!mod) { ctx.log('$.weapons.mod: нужно поле id'); return null; }
            mods.set(mod.id, mod);
            return mod;
        },

        /**
         * Ствол по id. Если ствола нет, отдаём навесное: `db` служит реестром
         * и для него тоже, и без этого `createWeapon('ak', { mods: db })` не
         * находил моды (get искал только стволы — на этом и был баг).
         */
        get(id) {
            const key = String(id);
            return guns.get(key) || mods.get(key) || null;
        },
        mod(id) { return mods.get(String(id)) || null; },
        has(id) { return guns.has(String(id)); },
        ids() { return [...guns.keys()]; },
        modIds() { return [...mods.keys()]; },
        list() { return [...guns.values()]; },
        clear() { const n = guns.size + mods.size; guns.clear(); mods.clear(); return n; },

        /** Загрузить пачку стволов (`{ weapons: [...] }` тоже). */
        load(data) {
            if (!data || typeof data !== 'object') return 0;
            const list = Array.isArray(data) ? data : (data.weapons || []);
            let count = 0;
            for (const raw of list) if (db.define(raw)) count++;
            return count;
        },

        /** Загрузить пачку навесного. */
        loadMods(data) {
            if (!data || typeof data !== 'object') return 0;
            const list = Array.isArray(data) ? data : (data.mods || []);
            let count = 0;
            for (const raw of list) if (db.defineMod(raw)) count++;
            return count;
        },
    };

    return db;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installWeapons($) {
    const db = createWeapons();
    const held = new WeakMap();       // узел → ствол в руках

    const api = {
        /** Описать ствол. */
        define(raw) { return db.define(raw); },
        /** Описать навесное: слот, множители, добавки. */
        defineMod(raw) { return db.defineMod(raw); },
        mod(id) { return db.mod(id); },
        get(id) { return db.get(id); },
        has(id) { return db.has(id); },
        ids() { return db.ids(); },
        list() { return db.list(); },
        modIds() { return db.modIds(); },
        clear() { return db.clear(); },
        load(data) { return db.load(data); },
        loadMods(data) { return db.loadMods(data); },

        /** Загрузить стволы из JSON-файла. */
        loadFile(source) {
            if (typeof source !== 'string') return db.load(source);
            const fs = $.fs || ctx.fs;
            if (!fs || typeof fs.readJSON !== 'function') {
                ctx.log('$.weapons.loadFile: нет $.fs — передайте данные как объект');
                return 0;
            }
            const data = fs.readJSON(source, null);
            if (!data) { ctx.log(`$.weapons.loadFile: не удалось прочитать «${source}»`); return 0; }
            const guns = db.load(data);
            const modsCount = db.loadMods(data);
            return guns + modsCount;
        },

        /** Новый ствол в руках: `$.weapons.create('ak')`. */
        create(id) { return createWeapon(id, { defs: db, mods: db }); },

        /** Чистое ядро — для тестов и своих баз. */
        createWeapon,
        createWeapons,

        /** Итоговые характеристики с навесным. */
        combineStats,
        /** Затухание урона по расстоянию. */
        falloff,
        /** Класс брони с учётом пробития. */
        penetrationAgainst,
        /** Разброс выстрела в градусах. */
        spreadFor,

        /** Дать ствол узлу: `$.weapons.give('#hero', 'ak')`. */
        give(what, id) {
            const node = resolveNode(what);
            if (!node) { ctx.log('$.weapons.give: узел не найден'); return null; }
            const weapon = createWeapon(id, { defs: db, mods: db });
            if (weapon) held.set(node, weapon);
            return weapon;
        },

        /** Ствол в руках узла (или null). */
        of(what) {
            const node = resolveNode(what);
            return node ? (held.get(node) || null) : null;
        },

        /**
         * Выстрел от имени узла: `$.weapons.fire('#hero', { held: true })`.
         * Возвращает результат `weapon.fire()` или `{ fired: false }`.
         */
        fire(what, opts) {
            const weapon = api.of(what);
            if (!weapon) return { fired: false, reason: 'no-weapon' };
            return weapon.fire(opts);
        },

        /** Тик всех стволов в руках: темп, перезарядка, остывание. */
        tickAll(dt) {
            let count = 0;
            for (const node of ctx.nodes || []) {
                const weapon = held.get(node);
                if (weapon) { weapon.tick(dt); count++; }
            }
            return count;
        },
    };

    $.weapons = api;
    ctx.weapons = api;
    return api;
}

/** Узел по обёртке, узлу или селектору. */
function resolveNode(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        // Здесь достаточно реестра: query тянет ядро, а нам нужен только узел.
        const list = ctx.byId;
        if (list && list.get) return list.get(String(what).replace(/^#/, '')) || null;
        return null;
    }
    if (what.nodes) return what.nodes[0] || null;
    return what.tag ? what : null;
}
