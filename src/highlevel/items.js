// ===========================================================================
// Предметы и инвентарь — $.items, $.inv
//
// Порт из audm-neko (game/items/item_def.gd, items.gd, bag/схрон). Там предмет
// был .tres-ресурсом с размером в клетках рюкзака, массой, слотом ношения и
// эффектами (лечение, еда, патроны, броня); списки хранили только id и штуки.
//
//   $.items.define({ id: 'medkit', title: 'Аптечка', kind: 'med', size: [1, 2],
//                    mass: 0.6, heal: 40, value: 300 });
//   $.items.define({ id: 'ak', title: 'АК', kind: 'weapon', size: [6, 2],
//                    mass: 3.8, value: 9000, wear: 'back' });
//
//   const bag = $.inv.create({ cols: 8, rows: 6, capacity: 25 });
//   bag.add('medkit', 2);           // уложит в свободные клетки
//   bag.has('medkit', 1);           // есть ли
//   bag.remove('medkit', 1);
//   bag.wear('armor_light');        // надеть в свой слот
//   bag.mass();                     // вес, кг
//   bag.list();                     // [{ id, count, x, y, w, h }]
//
// Ячейки: предмет занимает `size` клеток и лежит в контейнере целиком — как в
// оригинале, где автомат занимал 6×2, а бинт 1×1. Укладка идёт сканированием
// сетки сверху вниз, слева направо: результат детерминированный, поэтому
// инвентарь воспроизводим в тестах и сейвах.
//
// Ядро (createItems, createInventory) не касается движка: определения, сетка,
// укладка, вес и сейв — чистые функции, проверяются юнит-тестом.
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: определения
// ---------------------------------------------------------------------------

const KINDS = ['weapon', 'part', 'ammo', 'med', 'other', 'food', 'armor', 'loot'];

/** Нормализовать определение предмета: размер, масса, слоты, эффекты. */
export function normalizeItem(raw) {
    if (!raw || !raw.id) return null;
    const size = Array.isArray(raw.size) ? raw.size : [1, 1];
    const kind = KINDS.includes(String(raw.kind)) ? String(raw.kind) : 'other';
    return {
        id: String(raw.id),
        title: raw.title || String(raw.id),
        kind,
        w: Math.max(1, Math.floor(Number(size[0]) || 1)),
        h: Math.max(1, Math.floor(Number(size[1] !== undefined ? size[1] : 1) || 1)),
        mass: Math.max(0, Number(raw.mass) || 0),
        value: Math.max(0, Math.floor(Number(raw.value) || 0)),
        // `stack` — сколько штук в одной стопке. Патроны и лут по умолчанию
        // складываются, всё остальное лежит поштучно.
        stack: Math.max(1, Math.floor(Number(raw.stack)
            || ((kind === 'ammo' || kind === 'loot') ? 60 : 1))),
        // Слот ношения: 'armor', 'helmet', 'rig', 'pack', 'back'… Пусто — не надевается.
        wear: raw.wear === undefined ? '' : String(raw.wear),
        slot: raw.slot === undefined ? -1 : Number(raw.slot),
        armor_class: Math.max(0, Math.floor(Number(raw.armor_class) || 0)),
        durability: Math.max(0, Number(raw.durability) || 0),
        heal: Math.max(0, Number(raw.heal) || 0),
        stops_bleeding: !!raw.stops_bleeding,
        food: Math.max(0, Number(raw.food) || 0),
        water: Math.max(0, Number(raw.water) || 0),
        ammo: Math.max(0, Math.floor(Number(raw.ammo) || 0)),
        carry_bonus: Math.max(0, Number(raw.carry_bonus) || 0),
        weapon: raw.weapon === undefined ? '' : String(raw.weapon),
        icon: raw.icon === undefined ? '' : String(raw.icon),
        lore: raw.lore || '',
    };
}

// ---------------------------------------------------------------------------
// Чистая часть: сетка
// ---------------------------------------------------------------------------

/**
 * Сетка занятости контейнера. `cells[y][x]` — id предмета или null.
 * Отдельный объект, чтобы укладку можно было проверить без инвентаря.
 */
export function createGrid(cols, rows) {
    const w = Math.max(1, Math.floor(Number(cols) || 1));
    const h = Math.max(1, Math.floor(Number(rows) || 1));
    const cells = [];
    for (let y = 0; y < h; ++y) cells.push(new Array(w).fill(null));
    return { cols: w, rows: h, cells };
}

/** Можно ли положить прямоугольник w×h в (x, y)? */
export function canPlace(grid, x, y, w, h, ignore) {
    if (!grid) return false;
    if (x < 0 || y < 0 || w <= 0 || h <= 0) return false;
    if (x + w > grid.cols || y + h > grid.rows) return false;
    for (let dy = 0; dy < h; ++dy) {
        for (let dx = 0; dx < w; ++dx) {
            const cell = grid.cells[y + dy][x + dx];
            if (cell !== null && cell !== ignore) return false;
        }
    }
    return true;
}

/** Первое свободное место для w×h (сверху вниз, слева направо). */
export function findPlace(grid, w, h, ignore) {
    for (let y = 0; y < grid.rows; ++y) {
        for (let x = 0; x < grid.cols; ++x) {
            if (canPlace(grid, x, y, w, h, ignore)) return { x, y };
        }
    }
    return null;
}

/** Занять или освободить прямоугольник. */
export function fillCells(grid, x, y, w, h, value) {
    for (let dy = 0; dy < h; ++dy) {
        for (let dx = 0; dx < w; ++dx) grid.cells[y + dy][x + dx] = value;
    }
}

// ---------------------------------------------------------------------------
// Чистое ядро: инвентарь
// ---------------------------------------------------------------------------

/**
 * Создать инвентарь. `spec`: `{ cols, rows, capacity, defs }`.
 * `capacity` — предел веса в килограммах (0 — без предела).
 */
export function createInventory(spec) {
    const cfg = spec || {};
    const defs = cfg.defs || createItems();
    const grid = createGrid(cfg.cols === undefined ? 8 : cfg.cols,
                            cfg.rows === undefined ? 6 : cfg.rows);
    const stacks = [];        // [{ id, count, x, y }]
    const worn = new Map();   // слот → { id, count }
    let capacity = Math.max(0, Number(cfg.capacity) || 0);
    let base_mass = Math.max(0, Number(cfg.baseMass) || 0);
    let money = Math.max(0, Math.floor(Number(cfg.money) || 0));

    function def(id) { return defs.get(id); }

    function entryAt(x, y) {
        const id = grid.cells[y] && grid.cells[y][x];
        if (!id) return null;
        return stacks.find((s) => s.id === id && s.x === x && s.y === y)
            || stacks.find((s) => s.id === id) || null;
    }

    function massOf(id, count) {
        const item = def(id);
        return item ? item.mass * count : 0;
    }

    const inv = {
        cols: grid.cols,
        rows: grid.rows,
        stacks,
        worn,

        /** Приписать определения (если инвентарь создан раньше). */
        defs(source) { return source ? createInventory(Object.assign({}, cfg, { defs: source })) : defs; },

        /** Базовая масса контейнера (сам рюкзак/схрон). */
        setBaseMass(value) {
            base_mass = Math.max(0, Number(value) || 0);
            return inv;
        },

        /** Найти место для предмета, не занимая его. */
        find(id) {
            const item = def(id);
            if (!item) return null;
            return findPlace(grid, item.w, item.h);
        },

        /** Хватает ли места для `count` штук. */
        fits(id, count) {
            const item = def(id);
            if (!item) return false;
            const n = Math.max(1, Math.floor(Number(count) || 1));
            const need = Math.ceil(n / item.stack);
            let free = 0;
            const probe = createGrid(grid.cols, grid.rows);
            for (let y = 0; y < grid.rows; ++y) probe.cells[y] = grid.cells[y].slice();
            for (let i = 0; i < need; ++i) {
                const at = findPlace(probe, item.w, item.h);
                if (!at) break;
                fillCells(probe, at.x, at.y, item.w, item.h, '__probe');
                free++;
            }
            return free >= need;
        },

        /**
         * Положить предметы. Возвращает положенное количество (может быть
         * меньше запрошенного, если места не хватило).
         */
        add(id, count) {
            const item = def(id);
            if (!item) { ctx.log(`$.inv.add: нет предмета "${id}"`); return 0; }
            let left = Math.max(1, Math.floor(Number(count) || 1));
            let placed = 0;
            // 1. Дополняем существующие стопки.
            if (item.stack > 1) {
                for (const stack of stacks) {
                    if (left <= 0) break;
                    if (stack.id !== item.id) continue;
                    const room = item.stack - stack.count;
                    if (room <= 0) continue;
                    const put = Math.min(room, left);
                    stack.count += put;
                    left -= put;
                    placed += put;
                }
            }
            // 2. Кладём новые стопки в свободные клетки.
            while (left > 0) {
                const at = findPlace(grid, item.w, item.h);
                if (!at) break;
                const put = Math.min(item.stack, left);
                stacks.push({ id: item.id, count: put, x: at.x, y: at.y });
                fillCells(grid, at.x, at.y, item.w, item.h, item.id);
                left -= put;
                placed += put;
            }
            if (left > 0) ctx.log(`$.inv.add("${id}"): не влезло ${left} шт.`);
            // Чистим пустые стопки: иначе они остались бы в списке и в счёте.
            for (let i = stacks.length - 1; i >= 0; --i) if (stacks[i].count <= 0) stacks.splice(i, 1);
            return placed;
        },

        /** Сколько штук предмета в контейнере (с надетым). */
        count(id) {
            let total = 0;
            for (const stack of stacks) if (stack.id === id) total += stack.count;
            for (const entry of worn.values()) if (entry.id === id) total += entry.count;
            return total;
        },

        /** Есть ли хотя бы `count` штук. */
        has(id, count) { return inv.count(id) >= Math.max(1, Math.floor(Number(count) || 1)); },

        /**
         * Убрать предметы. Возвращает убранное количество; занятые клетки
         * освобождаются только когда стопка кончилась.
         */
        remove(id, count) {
            const item = def(id);
            let left = Math.max(1, Math.floor(Number(count) || 1));
            let taken = 0;
            // Сначала снимаем надетое (иначе «сдать броню» требовало бы раздеть).
            for (const [slot, entry] of worn) {
                if (left <= 0) break;
                if (entry.id !== id) continue;
                const take = Math.min(entry.count, left);
                entry.count -= take;
                left -= take;
                taken += take;
                if (entry.count <= 0) worn.delete(slot);
            }
            for (const stack of stacks) {
                if (left <= 0) break;
                if (stack.id !== id) continue;
                const take = Math.min(stack.count, left);
                stack.count -= take;
                left -= take;
                taken += take;
                if (stack.count <= 0) {
                    if (item) fillCells(grid, stack.x, stack.y, item.w, item.h, null);
                    stack.count = 0;
                } else if (item) {
                    // Частичное снятие: клетки остаются занятыми — стопка ещё
                    // лежит. Раньше пустая стопка оставалась двойником в счёте,
                    // потому что её клетка не освобождалась.
                    fillCells(grid, stack.x, stack.y, item.w, item.h, stack.id);
                }
            }
            // Чистим пустые стопки.
            for (let i = stacks.length - 1; i >= 0; --i) if (stacks[i].count <= 0) stacks.splice(i, 1);
            return taken;
        },

        /** Общий вес в килограммах (без денег), с базовой массой контейнера. */
        mass() {
            let total = base_mass;
            for (const stack of stacks) total += massOf(stack.id, stack.count);
            for (const entry of worn.values()) total += massOf(entry.id, entry.count);
            return total;
        },

        /**
         * Предел переносимого веса. Бонусы рюкзака и разгрузки НЕ входят:
         * предел — это то, что задала игра, поэтому `setCapacity(8)` даёт
         * ровно 8, а не 8 плюс бонус (раньше смешение мешало и тестам, и
         * интерфейсу: «лимит» менялся от надетого рюкзака).
         */
        capacity() { return capacity; },

        /** Бонус переноса от надетого (рюкзак, разгрузка). */
        carryBonus() {
            let total = 0;
            for (const entry of worn.values()) {
                const item = def(entry.id);
                if (item) total += item.carry_bonus;
            }
            return total;
        },

        /** Сколько всего можно унести: предел плюс бонус надетого. */
        carryLimit() {
            const limit = inv.capacity();
            const bonus = inv.carryBonus();
            if (limit <= 0 && bonus <= 0) return 0;
            return limit + bonus;
        },

        /** Предел веса: 0 — без предела. */
        setCapacity(value) {
            // Числовой аргумент перекрывает прежнее значение; нечисловой —
            // снимает предел (иначе случайный вызов оставлял старый предел).
            capacity = value === undefined || value === null ? 0
                : Math.max(0, Number(value) || 0);
            return inv;
        },

        /** Не перегружен ли (при нулевом пределе — никогда). */
        overloaded() {
            const limit = inv.carryLimit();
            return limit > 0 && inv.mass() > limit;
        },

        /** Общая ценность содержимого. */
        value() {
            let total = 0;
            for (const stack of stacks) {
                const item = def(stack.id);
                if (item) total += item.value * stack.count;
            }
            for (const entry of worn.values()) {
                const item = def(entry.id);
                if (item) total += item.value * entry.count;
            }
            return total;
        },

        /** Деньги (для торговца и награды). */
        get money() { return money; },
        set money(value) { money = Math.max(0, Math.floor(Number(value) || 0)); },
        addMoney(value) {
            money = Math.max(0, money + Math.floor(Number(value) || 0));
            return money;
        },

        // --- Ношение -----------------------------------------------------------
        /**
         * Надеть предмет в его слот.
         *
         * Возвращает ИМЯ надетого предмета при успехе и null — если надеть
         * нельзя или предмета нет. Прежний предмет слота возвращается в
         * контейнер (раньше функция возвращала прежний предмет, из-за чего
         * успешное надевание выглядело как отказ, а прежний терялся).
         */
        wear(id) {
            const item = def(id);
            if (!item) return null;
            if (!item.wear) { ctx.log(`$.inv.wear: "${id}" не надевается`); return null; }
            // Уже надет этот же предмет — второй раз надевать нечего.
            const inSlot = worn.get(item.wear);
            if (inSlot && inSlot.id === item.id) return item.id;
            if (inv.count(id) <= 0) { ctx.log(`$.inv.wear: "${id}" нет в контейнере`); return null; }

            const previous = inSlot ? inSlot : null;
            // Снимаем надеваемое из контейнера: оно уходит в слот.
            inv.remove(id, 1);
            // Прежний предмет слота возвращается в контейнер.
            if (previous) {
                worn.delete(item.wear);
                inv.add(previous.id, previous.count);
            }
            worn.set(item.wear, { id: item.id, count: 1 });
            return item.id;
        },

        /** Снять из слота (вернуть содержимое в контейнер). */
        unwear(slot) {
            const name = String(slot);
            const entry = worn.get(name);
            if (!entry) return null;
            // Снимаем только при наличии места: иначе предмет пропал бы.
            const probe = createGrid(grid.cols, grid.rows);
            for (let y = 0; y < grid.rows; ++y) probe.cells[y] = grid.cells[y].slice();
            const item = def(entry.id);
            const w = item ? item.w : 1;
            const h = item ? item.h : 1;
            const at = findPlace(probe, w, h);
            if (!at) {
                ctx.log(`$.inv.unwear("${name}"): нет места для "${entry.id}" — остаётся надетым`);
                return null;
            }
            worn.delete(name);
            inv.add(entry.id, entry.count);
            return entry.id;
        },

        /** Что надето: `{ слот: id }`. */
        wornList() {
            const out = {};
            for (const [slot, entry] of worn) out[slot] = entry.id;
            return out;
        },

        /**
         * Класс защиты. Без аргумента — лучший по всем надёванным слотам;
         * с аргументом — только этот слот (пустой слот даёт 0, а не чужую
         * броню: раньше `armorClass('helmet')` возвращал класс жилета).
         */
        armorClass(slot) {
            if (slot !== undefined) {
                const entry = worn.get(String(slot));
                if (!entry) return 0;
                const item = def(entry.id);
                return item ? item.armor_class : 0;
            }
            let best = 0;
            for (const entry of worn.values()) {
                const item = def(entry.id);
                if (item) best = Math.max(best, item.armor_class);
            }
            return best;
        },

        // --- Список ------------------------------------------------------------
        /** Содержимое: `[{ id, count, x, y, w, h, title, mass }]`. */
        list() {
            return stacks.map((stack) => {
                const item = def(stack.id);
                return {
                    id: stack.id,
                    count: stack.count,
                    x: stack.x,
                    y: stack.y,
                    w: item ? item.w : 1,
                    h: item ? item.h : 1,
                    title: item ? item.title : stack.id,
                    mass: massOf(stack.id, stack.count),
                };
            });
        },

        /** Сводка по id: `{ id: штук }`. */
        summary() {
            const out = {};
            for (const stack of stacks) out[stack.id] = (out[stack.id] || 0) + stack.count;
            for (const entry of worn.values()) out[entry.id] = (out[entry.id] || 0) + entry.count;
            return out;
        },

        /** Сортировка содержимого по ценности (дорогое — вверх). */
        sortByValue() {
            stacks.sort((a, b) => {
                const ia = def(a.id);
                const ib = def(b.id);
                return (ib ? ib.value : 0) - (ia ? ia.value : 0);
            });
            return inv;
        },

        /** Уложить заново: освобождает сетку и раскладывает стопки подряд. */
        repack() {
            fillCells(grid, 0, 0, grid.cols, grid.rows, null);
            const snapshot = stacks.map((s) => ({ id: s.id, count: s.count }));
            stacks.length = 0;
            for (const entry of snapshot) inv.add(entry.id, entry.count);
            return inv;
        },

        /** Снимок для сейва. */
        save() {
            return {
                money,
                stacks: stacks.map((s) => ({ id: s.id, count: s.count })),
                worn: Object.fromEntries([...worn.entries()].map(([slot, e]) => [slot, e.id])),
            };
        },

        /** Восстановить из сейва (укладывает заново по сетке). */
        load(data) {
            if (!data || typeof data !== 'object') return inv;
            for (let i = stacks.length - 1; i >= 0; --i) stacks.splice(i, 1);
            fillCells(grid, 0, 0, grid.cols, grid.rows, null);
            worn.clear();
            money = Math.max(0, Math.floor(Number(data.money) || 0));
            for (const entry of data.stacks || []) inv.add(entry.id, entry.count);
            const wornData = data.worn || {};
            for (const slot of Object.keys(wornData)) {
                const item = def(wornData[slot]);
                if (item && item.wear) worn.set(String(slot), { id: item.id, count: 1 });
            }
            return inv;
        },
    };

    // Поле `stacks` в save() — те же объекты; отдаём копии, чтобы сейв не менялся.
    inv.stackAt = (x, y) => entryAt(x, y);
    return inv;
}

// ---------------------------------------------------------------------------
// Чистое ядро: определения
// ---------------------------------------------------------------------------

export function createItems() {
    const map = new Map();

    const items = {
        define(raw) {
            const item = normalizeItem(raw);
            if (!item) { ctx.log('$.items.define: нужно поле id'); return null; }
            map.set(item.id, item);
            return item;
        },

        get(id) { return map.get(String(id)) || null; },
        has(id) { return map.has(String(id)); },
        remove(id) { return map.delete(String(id)); },
        ids() { return [...map.keys()]; },
        list() { return [...map.values()]; },
        clear() { const n = map.size; map.clear(); return n; },

        /** Загрузить пачку: `$.items.load([{...}, {...}])` или `{ items: [...] }`. */
        load(data) {
            if (!data || typeof data !== 'object') return 0;
            const list = Array.isArray(data) ? data : (data.items || []);
            let count = 0;
            for (const raw of list) if (items.define(raw)) count++;
            return count;
        },

        /** Сколько штук поместится по весу (0 — без предела). */
        massLimit() { return 0; },
    };

    return items;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installItems($) {
    const items = createItems();

    /** Создать инвентарь (рюкзак, схрон, тайник). */
    function makeInventory(spec) {
        return createInventory(Object.assign({ defs: items }, spec || {}));
    }

    const api = {
        /** Определения предметов. */
        define(raw) { return items.define(raw); },
        get(id) { return items.get(id); },
        has(id) { return items.has(id); },
        ids() { return items.ids(); },
        list() { return items.list(); },
        remove(id) { return items.remove(id); },
        clear() { return items.clear(); },
        load(data) { return items.load(data); },

        /**
         * Загрузить предметы из JSON-файла: `$.items.loadFile('items.json')`
         * или сразу массив. Поддерживает `{ items: [...] }`.
         */
        loadFile(source) {
            if (typeof source !== 'string') return items.load(source);
            const fs = $.fs || ctx.fs;
            if (!fs || typeof fs.readJSON !== 'function') {
                ctx.log('$.items.loadFile: нет $.fs — передайте данные как объект');
                return 0;
            }
            const data = fs.readJSON(source, null);
            if (!data) { ctx.log(`$.items.loadFile: не удалось прочитать «${source}»`); return 0; }
            return items.load(data);
        },

        /** Новый инвентарь: `$.inv.create({ cols: 8, rows: 6, capacity: 25 })`. */
        create(spec) { return makeInventory(spec); },

        /** Инвентарь с нуля (пустой, без определений) — для тестов. */
        createInventory,

        /** Разложить стопки в сейве заново по сетке. */
        restore(saveData, spec) {
            const inv = makeInventory(spec);
            inv.load(saveData);
            return inv;
        },
    };

    $.items = api;
    $.inv = api;
    ctx.items = api;
    return api;
}
