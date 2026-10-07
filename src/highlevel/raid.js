// ===========================================================================
// Генерация рейда — $.raid
//
// Порт из audm-neko (game/raid/gen/world_plan.gd, village_plan.gd,
// world_stream.gd). В оригинале мир был ОДНОЙ большой связной картой: районы
// слева направо (деревня → ПГТ → город → промзона → пойма), рельеф шумом,
// постройки по районам, точки интереса, выходы и бюджет спавна, который
// наполнялся СТРИМИНГОМ по чанкам вокруг бойца.
//
//   const raid = $.raid.create({ seed: 1234, width: 2400, chunk: 32 });
//   raid.generate();
//   raid.districts();          // [{ id, title, from, to, kind }]
//   raid.heightAt(500);        // рельеф в тайлах
//   raid.buildings();          // [{ x, y, w, h, kind, district }]
//   raid.exits();              // [{ x, y, title }]
//   raid.stream(heroX);        // чанки в окне — в мир, дальние — прочь
//   raid.spawns();             // что должно появиться в загруженных чанках
//
// Почему стриминг, а не «сгенерировать всё сразу». Мир на 6000 тайлов — это
// сотни построек и сотни NPC; в кадр их ставить нельзя. Оригинал держал мир в
// плане (он дёшев: только числа), а в сцену добавлял содержимое чанков вокруг
// игрока с жёсткими капами. Здесь то же: `stream(x)` отдаёт список чанков на
// загрузку и выгрузку, а что именно в них создавать — решает игра.
//
// Ядро (createRaid и его генераторы) не касается движка: районы, рельеф,
// постройки, выходы и стриминг — чистые функции от seed, поэтому генерация
// детерминирована и проверяется юнит-тестом (tests/js/raid_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: случайность и шум
// ---------------------------------------------------------------------------

/** Быстрый детерминированный генератор: одинаковый seed — одинаковый мир. */
export function makeRandom(seed) {
    // Сид РАЗМЕШИВАЕТСЯ: у голого xorshift32 первые значения для соседних сидов
    // почти одинаковы (для 320..334 первые вызовы давали ~0.02), и вся первая
    // генерация — границы районов, первый дом, погода — выходила одинаковой.
    // Финализатор MurmurHash3 даёт лавину: соседние сиды расходятся сразу.
    let state = (Math.floor(Number(seed) || 1) >>> 0) || 1;
    state ^= state >>> 16; state = Math.imul(state, 0x7feb352d) >>> 0;
    state ^= state >>> 15; state = Math.imul(state, 0x846ca68b) >>> 0;
    state ^= state >>> 16;
    if (state === 0) state = 0x9e3779b9;

    const next = () => {
        // xorshift32: коротко, быстро, воспроизводимо.
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 4294967296;
    };
    return {
        next,
        /** Целое в [lo, hi]. */
        int(lo, hi) {
            const a = Math.ceil(lo);
            const b = Math.floor(hi);
            return a + Math.floor(next() * (b - a + 1));
        },
        /** Дробное в [lo, hi). */
        range(lo, hi) { return lo + next() * (hi - lo); },
        /** Один из элементов. */
        pick(list) { return list.length ? list[Math.floor(next() * list.length) % list.length] : null; },
        /** Шанс 0..1. */
        chance(p) { return next() < p; },
    };
}

/** Гладкий 1D-шум: несколько октав косинуса — рельеф без ступеней. */
export function heightNoise(x, seed, octaves) {
    const count = Math.max(1, Math.floor(octaves || 3));
    let value = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1 / 220;
    for (let i = 0; i < count; ++i) {
        const phase = (seed % 1000) * 0.7 + i * 13.37;
        value += Math.sin(x * frequency + phase) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
    }
    return total > 0 ? value / total : 0;
}

// ---------------------------------------------------------------------------
// Чистая часть: раскладка мира
// ---------------------------------------------------------------------------

/**
 * Районы по умолчанию: порядок слева направо, от деревни к промзоне и пойме.
 * `frac` — доля ширины мира, `kind` — вид застройки, `forest`/`loot` —
 * множители плотности, `relief` — насколько силён рельеф.
 */
export const DISTRICTS = [
    { id: 'village', title: 'Деревня', kind: 'izba', frac: 0.16, forest: 1.15, loot: 1.0, relief: 1.0, buildings: 22 },
    { id: 'pgt', title: 'ПГТ', kind: 'khrushchevka', frac: 0.18, forest: 0.55, loot: 1.3, relief: 0.6, buildings: 26 },
    { id: 'city', title: 'Город', kind: 'khrushchevka', frac: 0.22, forest: 0.25, loot: 1.5, relief: 0.45, buildings: 34 },
    { id: 'industry', title: 'Промзона', kind: 'garages', frac: 0.20, forest: 0.15, loot: 1.4, relief: 0.4, buildings: 24 },
    { id: 'swamp', title: 'Пойма', kind: 'hut', frac: 0.24, forest: 1.6, loot: 0.8, relief: 0.25, buildings: 12 },
];

/** Раскладка районов по ширине мира. */
export function layoutDistricts(width, seed, spec) {
    const list = spec && spec.length ? spec : DISTRICTS;
    const random = makeRandom(seed);
    const total = list.reduce((sum, d) => sum + (Number(d.frac) || 0), 0) || 1;
    const out = [];
    let cursor = 0;
    for (const district of list) {
        const share = (Number(district.frac) || 0) / total;
        // Сид слегка двигает границы: два рейда с разными сидами не одинаковы.
        const jitter = random.range(-0.02, 0.02);
        const from = Math.round(cursor * width);
        cursor += share + jitter;
        const to = Math.min(width, Math.round(cursor * width));
        out.push({
            id: String(district.id),
            title: district.title || String(district.id),
            kind: String(district.kind || 'izba'),
            from,
            to: Math.max(from + 1, to),
            forest: Number(district.forest) || 1,
            loot: Number(district.loot) || 1,
            relief: Number(district.relief) || 1,
            buildings: Math.max(1, Math.floor(Number(district.buildings) || 10)),
        });
    }
    // Последний район тянем до края: округления не должны оставить пустоту.
    if (out.length) out[out.length - 1].to = width;
    return out;
}

/** Какой район на этой координате. */
export function districtAt(districts, x) {
    if (!districts.length) return null;
    // Левее мира — первый район, правее — последний: прежняя версия отдавала
    // последний и для отрицательных координат (нашлось тестом).
    if (x < districts[0].from) return districts[0];
    for (const d of districts) if (x >= d.from && x < d.to) return d;
    return districts[districts.length - 1];
}

/** Рельеф: пологая волна, усиленная районом (в промзоне ровнее, в деревне сильнее). */
export function heightAt(x, seed, districts, spec) {
    const d = districtAt(districts, x);
    const relief = d ? d.relief : 1;
    const base = (Number(spec && spec.baseHeight) || 40);
    const amplitude = (Number(spec && spec.relief) || 6) * relief;
    return Math.round(base + heightNoise(x, seed, 3) * amplitude);
}

/** Постройки района: дома по обе стороны от «улицы», вдоль оси X. */
export function planBuildings(district, seed, spec) {
    const random = makeRandom(seed + district.from * 7 + district.id.length * 13);
    const out = [];
    const street = Number(spec && spec.street) || 0;
    const ground = Number(spec && spec.groundY) || 40;
    const { width, height } = sizesFor(district.kind, random);
    const gap = 2;
    let x = district.from + random.int(4, 12);
    for (let i = 0; i < district.buildings; ++i) {
        const w = random.int(width[0], width[1]);
        const h = random.int(height[0], height[1]);
        if (x + w > district.to) break;
        // Чётные — сверху от улицы, нечётные — снизу: так получается улица.
        const above = (i % 2) === 0;
        const y = above ? ground - street - h : ground + street;
        out.push({
            x, y, w, h,
            kind: district.kind,
            district: district.id,
            // Внутренние комнаты: их режет игра, а не генератор.
            rooms: Math.max(1, Math.floor((w * h) / 12)),
        });
        x += w + gap + random.int(0, 3);
    }
    return out;
}

/** Диапазон размеров постройки по виду застройки. */
function sizesFor(kind, random) {
    switch (String(kind)) {
        case 'khrushchevka': return { width: [8, 14], height: [5, 8] };
        case 'garages': return { width: [3, 5], height: [3, 4] };
        case 'hut': return { width: [3, 5], height: [3, 4] };
        case 'izba': return { width: [5, 9], height: [4, 6] };
        default: return { width: [4, 8], height: [4, 6] };
    }
}

/**
 * Выходы из рейда: по одному на район плюс пара «дальних» — они и есть цель
 * эвакуации. Подпись и ключ нужны квестам (`extract`).
 */
export function planExits(districts, seed, spec) {
    const random = makeRandom(seed + 991);
    const out = [];
    for (const d of districts) {
        out.push({
            x: random.int(d.from + 8, Math.max(d.from + 9, d.to - 8)),
            y: 0,
            district: d.id,
            key: d.id,
            title: `Выход: ${d.title}`,
        });
    }
    // Дальний выход — на самом краю: за него дают больше.
    const last = districts.length ? districts[districts.length - 1] : null;
    if (last) {
        out.push({ x: Math.max(0, last.to - 4), y: 0, district: last.id,
                   key: 'far', title: 'Дальний выход' });
    }
    return out;
}

/** Точки интереса: их подхватывают квесты и лут. */
export function planPoints(districts, buildings, seed) {
    const random = makeRandom(seed + 4242);
    const out = [];
    const kinds = ['fuel', 'school', 'hospital', 'club', 'garages', 'checkpoint'];
    for (const b of buildings) {
        if (!random.chance(0.18)) continue;
        out.push({
            x: b.x + Math.floor(b.w / 2),
            y: b.y + b.h,
            kind: random.pick(kinds),
            district: b.district,
        });
    }
    return out;
}

/**
 * Тайники и NPC по районам: плотность берётся из района, множителями её правит
 * игра. Возвращает план (числа), а не объекты мира.
 */
export function planSpawns(districts, seed, spec) {
    const random = makeRandom(seed + 777);
    const loot = [];
    const npcs = [];
    const lootCap = Math.max(0, Math.floor(Number(spec && spec.lootCap) || 400));
    const npcCap = Math.max(0, Math.floor(Number(spec && spec.npcCap) || 220));
    for (const d of districts) {
        const lootCount = Math.min(lootCap - loot.length, Math.round(8 * d.loot));
        for (let i = 0; i < lootCount; ++i) {
            loot.push({ x: random.int(d.from, d.to - 1), district: d.id });
        }
        const npcCount = Math.min(npcCap - npcs.length, Math.round(4 * d.forest));
        for (let i = 0; i < npcCount; ++i) {
            npcs.push({ x: random.int(d.from, d.to - 1), district: d.id });
        }
    }
    return { loot, npcs };
}

/** Номер чанка по координате. */
export function chunkIndex(x, chunk) {
    const size = Math.max(1, Math.floor(Number(chunk) || 32));
    return Math.floor(x / size);
}

/**
 * Какие чанки должны быть загружены вокруг позиции. Возвращает
 * `{ load: [индексы], keep: Set }` — список на загрузку и множество нужных.
 */
export function planStream(x, chunk, radius) {
    const size = Math.max(1, Math.floor(Number(chunk) || 32));
    const r = Math.max(0, Math.floor(Number(radius) || 2));
    const center = chunkIndex(x, size);
    const load = [];
    for (let i = center - r; i <= center + r; ++i) if (i >= 0) load.push(i);
    return { load, keep: new Set(load) };
}

// ---------------------------------------------------------------------------
// Ядро рейда
// ---------------------------------------------------------------------------

/**
 * Создать план рейда. `spec`: `{ seed, width, chunk, radius, districts,
 * baseHeight, relief, street, groundY, lootCap, npcCap }`.
 */
export function createRaid(spec) {
    const cfg = spec || {};
    let seed = Math.floor(Number(cfg.seed) || 1);
    const width = Math.max(64, Math.floor(Number(cfg.width) || 2400));
    const chunk = Math.max(8, Math.floor(Number(cfg.chunk) || 32));
    const radius = Math.max(0, Math.floor(Number(cfg.radius) || 2));
    const groundY = Math.max(4, Math.floor(Number(cfg.groundY) || 40));
    const street = Math.max(1, Math.floor(Number(cfg.street) || 3));

    let districts = [];
    let buildings = [];
    let exits = [];
    let points = [];
    let loot = [];
    let npcs = [];
    let generated = false;
    let weather = null;

    const loaded = new Set();     // номера загруженных чанков
    const pending = [];           // чанки, которые игра должна наполнить

    const raid = {
        // СИД — геттер, а не снимок: объект создавался со значением на момент
        // создания, и reseed()/load() меняли переменную, но не то, что видит
        // игра (смена сида «не работала» — нашлось тестом).
        get seed() { return seed; },
        get width() { return width; },
        get chunk() { return chunk; },
        get radius() { return radius; },
        get generated() { return generated; },
        get groundY() { return groundY; },

        /** Районы слева направо. */
        districts() { return districts.map((d) => Object.assign({}, d)); },
        /** Какой район на координате. */
        districtAt(x) { return districtAt(districts, x); },
        /** Рельеф (высота поверхности в тайлах). */
        heightAt(x) { return heightAt(x, seed, districts, { baseHeight: groundY, relief: cfg.relief }); },
        /** Постройки. */
        buildings() { return buildings.map((b) => Object.assign({}, b)); },
        /** Выходы: цель эвакуации. */
        exits() { return exits.map((e) => Object.assign({}, e)); },
        /** Точки интереса. */
        points() { return points.map((p) => Object.assign({}, p)); },
        /** План тайников и NPC. */
        spawns() { return { loot: loot.slice(), npcs: npcs.slice() }; },
        /** Погода плана (см. `$.raid.weather`). */
        weather() { return weather ? Object.assign({}, weather) : null; },
        /** Задать погоду плана (обычно ставит подсистема). */
        setWeather(value) { weather = value ? Object.assign({}, value) : null; return raid; },

        /** Сколько чанков сейчас загружено. */
        loadedChunks() { return [...loaded].sort((a, b) => a - b); },
        /** Чанки, ожидающие наполнения (игра читает и очищает). */
        takePending() { const out = pending.slice(); pending.length = 0; return out; },

        /** Сгенерировать план (идемпотентно). */
        generate() {
            if (generated) return raid;
            districts = layoutDistricts(width, seed, cfg.districts);
            buildings = [];
            for (const d of districts) {
                buildings = buildings.concat(planBuildings(d, seed, { street, groundY }));
            }
            exits = planExits(districts, seed);
            points = planPoints(districts, buildings, seed);
            const planned = planSpawns(districts, seed, cfg);
            loot = planned.loot;
            npcs = planned.npcs;
            generated = true;
            return raid;
        },

        /**
         * Стриминг: какие чанки держать вокруг `x`. Возвращает
         * `{ load, unload }` — номера чанков на загрузку и на выгрузку.
         */
        stream(x) {
            if (!generated) raid.generate();
            const plan = planStream(x, chunk, radius);
            const load = [];
            for (const index of plan.load) {
                if (loaded.has(index)) continue;
                loaded.add(index);
                load.push(index);
                pending.push(index);
            }
            const unload = [];
            for (const index of [...loaded]) {
                if (!plan.keep.has(index)) {
                    loaded.delete(index);
                    unload.push(index);
                }
            }
            return { load, unload };
        },

        /** Содержимое чанка: постройки, тайники, NPC, точки и выходы внутри. */
        chunkContent(index) {
            if (!generated) raid.generate();
            const from = index * chunk;
            const to = from + chunk;
            const inside = (x) => x >= from && x < to;
            const terrain = [];
            for (let x = from; x < to; x += Math.max(1, Math.floor(chunk / 4))) {
                terrain.push(raid.heightAt(x));
            }
            return {
                index,
                from,
                to,
                heights: terrain,
                buildings: buildings.filter((b) => inside(b.x) || (b.x < from && b.x + b.w > from)),
                loot: loot.filter((l) => inside(l.x)),
                npcs: npcs.filter((n) => inside(n.x)),
                points: points.filter((p) => inside(p.x)),
                exits: exits.filter((e) => inside(e.x)),
            };
        },

        /** Сброс: план и загруженные чанки (новый рейд с тем же сидом). */
        reset() {
            districts = [];
            buildings = [];
            exits = [];
            points = [];
            loot = [];
            npcs = [];
            generated = false;
            loaded.clear();
            pending.length = 0;
            return raid;
        },

        /** Сменить сид (новый рейд). */
        reseed(value) {
            const next = Math.floor(Number(value) || 1);
            if (next === seed) return raid;
            seed = next;
            return raid.reset();
        },

        /** Снимок плана для сейва (только числа). */
        save() {
            return {
                seed, width, chunk, radius,
                generated,
                loaded: [...loaded].sort((a, b) => a - b),
            };
        },

        /** Восстановить из сейва. */
        load(data) {
            if (!data || typeof data !== 'object') return raid;
            raid.reset();
            if (data.seed !== undefined) seed = Math.floor(Number(data.seed) || 1);
            generated = false;
            raid.generate();
            for (const index of data.loaded || []) loaded.add(Math.floor(Number(index)));
            return raid;
        },
    };

    return raid;
}

// ---------------------------------------------------------------------------
// Погода (порт raid_weather.gd)
// ---------------------------------------------------------------------------

/** Виды погоды и их влияние: видимость, ветер, шум. */
export const WEATHERS = [
    { id: 'clear', title: 'Ясно', fog: 0, rain: 0, wind: 0.2, loud: 1.0, light: 1.0 },
    { id: 'overcast', title: 'Пасмурно', fog: 0.1, rain: 0, wind: 0.4, loud: 1.0, light: 0.85 },
    { id: 'rain', title: 'Дождь', fog: 0.25, rain: 0.6, wind: 0.6, loud: 0.7, light: 0.7 },
    { id: 'storm', title: 'Гроза', fog: 0.4, rain: 1, wind: 0.9, loud: 0.5, light: 0.55 },
    { id: 'fog', title: 'Туман', fog: 0.7, rain: 0, wind: 0.1, loud: 1.1, light: 0.6 },
];

/** Выбрать погоду по сиду: ясная чаще, гроза реже. */
export function pickWeather(seed) {
    const random = makeRandom(seed + 313);
    const roll = random.next();
    if (roll < 0.32) return WEATHERS[0];
    if (roll < 0.58) return WEATHERS[1];
    if (roll < 0.82) return WEATHERS[2];
    if (roll < 0.93) return WEATHERS[4];
    return WEATHERS[3];
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installRaid($) {
    let current = null;

    const api = {
        /** Создать план рейда: `$.raid.create({ seed, width, chunk })`. */
        create(spec) { return createRaid(spec); },

        /** Текущий рейд (или null). */
        current() { return current; },

        /**
         * Начать рейд: создаёт план, генерирует и запоминает как текущий.
         * `$.raid.start({ seed: 42 })`.
         */
        start(spec) {
            current = createRaid(spec || {});
            current.generate();
            return current;
        },

        /** Закончить рейд: план забывается. */
        end() {
            const was = current;
            current = null;
            return was;
        },

        /**
         * Погода: `$.raid.weather(seed)` — по сиду, `$.raid.weather()` — текущего
         * рейда. Считается один раз за рейд и живёт в его плане (раньше поле
         * писалось в план, но читалось не оттуда — погода каждый раз была новой).
         */
        weather(seed) {
            if (seed !== undefined) return pickWeather(seed);
            if (!current) return pickWeather(1);
            const stored = current.weather();
            if (stored) return stored;
            current.setWeather(pickWeather(current.seed));
            return current.weather();
        },

        /** Виды погоды — для интерфейса и тестов. */
        weathers() { return WEATHERS.map((w) => Object.assign({}, w)); },

        /** Чистые помощники (для тестов и своих генераторов). */
        createRaid,
        makeRandom,
        heightNoise,
        layoutDistricts,
        planBuildings,
        planExits,
        planSpawns,
        planStream,
        chunkIndex,
        districtAt,
        heightAt,

        /** Высота по координате текущего рейда (или null). */
        heightAt(x) { return current ? current.heightAt(x) : null; },

        /** Стриминг текущего рейда: `$.raid.stream(heroX)`. */
        stream(x) { return current ? current.stream(x) : { load: [], unload: [] }; },

        /**
         * Наполнить мир содержимым чанков: `$.raid.fill({ onLoot, onNpc, onBuilding })`.
         * Игра сама решает, что создавать; генератор отдаёт числа.
         */
        fill(opts) {
            if (!current) return 0;
            const spec = opts || {};
            let count = 0;
            for (const index of current.takePending()) {
                const content = current.chunkContent(index);
                if (typeof spec.onChunk === 'function') { spec.onChunk(content); count++; }
                for (const loot of content.loot) {
                    if (typeof spec.onLoot === 'function') { spec.onLoot(loot); count++; }
                }
                for (const npc of content.npcs) {
                    if (typeof spec.onNpc === 'function') { spec.onNpc(npc); count++; }
                }
                for (const building of content.buildings) {
                    if (typeof spec.onBuilding === 'function') { spec.onBuilding(building); count++; }
                }
            }
            return count;
        },
    };

    $.raid = api;
    ctx.raid = api;
    return api;
}
