// ===========================================================================
// Акустика помещений: $.audio.room / zone / listener.
//
// Задача: чтобы выстрел в комнате 5×5 и в зале 20×20 звучал по-разному.
// Разницу даёт хвост реверберации, и он у нас теперь есть (Freeverb,
// src/audio_reverb.c). Здесь — модель, которая решает, КАКАЯ это комната:
//
//   1. зона-прямоугольник + высота потолка (в 2D-мире его нет, поэтому он
//      задаётся явно) дают объём V и площадь поверхностей S;
//   2. по формуле Сабина RT60 = 0.161·V / (S·α) считается время реверберации,
//      где α — поглощение материала стен;
//   3. RT60 → «размер» и «яркость» хвоста Freeverb (room/damp), плюс доля
//      wet; параметры плавно подтягиваются к цели, иначе на границе зон щёлкает;
//   4. отдельно — окклюзия: источник за стеной глушится фильтром, но хвост
//      комнаты остаётся (именно так это и слышится).
//
// Всё, что нужно от движка: engine.audio.setRoom/setChannelEffect и
// $.world.lineOfSight — то есть ничего нового в C.
// ===========================================================================

import { ctx, query } from './core.js';

// Масштаб мира: 32 пикселя = 1 метр (тот же, что у физики, docs/API.md).
export const PX_PER_METER = 32;

// Поглощение (α) и демпфирование высоких для типовых материалов.
// α — «обставленная» комната, а не голый бетон: иначе формула Сабина даёт
// нереальные секунды для маленькой комнаты. Damp — насколько глухо звучит хвост.
export const MATERIALS = {
    concrete: { absorption: 0.10, damp: 0.45 },
    tile:     { absorption: 0.06, damp: 0.20 },   // плитка: ярко и звонко
    metal:    { absorption: 0.08, damp: 0.30 },
    glass:    { absorption: 0.08, damp: 0.20 },
    wood:     { absorption: 0.15, damp: 0.55 },
    carpet:   { absorption: 0.45, damp: 0.85 },   // ковры: коротко и глухо
    curtain:  { absorption: 0.60, damp: 0.90 },
    // Улица и лес: звук уходит в небо, хвоста почти нет, верх глушится листвой.
    grass:    { absorption: 0.35, damp: 0.75 },
};

// Улица: хвоста почти нет, высокие не задемпфированы.
const OUTDOOR = { wet: 0.06, room: 0.25, damp: 0.7, width: 1.0 };

const state = {
    zones: new Map(),        // имя → { rect, height, material, wet, smooth }
    listener: null,          // селектор или узел; null — слушатель это камера
    auto: true,              // самой считать комнату
    occlusion: true,         // глушить источники за стенами
    // Препятствия (деревья, колонны): чем плотнее чаща на пути звука, тем
    // глуше он звучит. Открытое поле — чистый звук.
    obstacles: [],
    obstacle_radius: 30,     // насколько близко к лучу считать препятствие
    obstacle_strength: 0.22, // прибавка глухости за каждое препятствие
    obstacle_max: 0.85,      // выше не глушим даже в самой чаще
    cutoff_clear: 18000,     // срез фильтра на открытом месте, Гц
    cutoff_dense: 650,       // срез фильтра в чаще, Гц
    smooth: 0.25,            // секунд на переход между комнатами
    current: { wet: 0, room: 0.5, damp: 0.5, width: 1 },
    applied: { wet: -1, room: -1, damp: -1, width: -1 },
    active: null,            // имя текущей зоны (для отладки и снимка)
};

// --- Чистая математика (проверяется юнит-тестами) ---------------------------

/** Объём и площадь поверхностей комнаты в метрах. */
export function roomVolume(width_px, depth_px, ceiling_m) {
    const w = Math.abs(width_px) / PX_PER_METER;
    const d = Math.abs(depth_px) / PX_PER_METER;
    const h = ceiling_m > 0 ? ceiling_m : 3;
    const volume = w * d * h;
    const surface = 2 * (w * d) + 2 * (w + d) * h;
    return { volume, surface, w, d, h };
}

/** Время реверберации по Сабине, секунды. */
export function rt60(volume, surface, absorption) {
    const a = absorption > 0 ? absorption : 0.05;
    if (surface <= 0) return 0;
    return 0.161 * volume / (surface * a);
}

/** Параметры реверба для зоны: rect = [x, y, w, h] в пикселях. */
export function reverbForZone(zone) {
    const rect = zone.rect || [0, 0, 100, 100];
    const { volume, surface } = roomVolume(rect[2], rect[3], zone.height);
    const mat = MATERIALS[zone.material] || MATERIALS.concrete;
    const t = rt60(volume, surface, mat.absorption);

    // RT60 → размер хвоста: 0.2 с — кладовка, 1.5 с и больше — бетонный зал.
    const room = clamp(0.12 + t * 0.45, 0.08, 1.0);
    // Доля хвоста: маленькая комната слышна слабо, зал — почти в ползвука.
    const wet = zone.wet !== undefined ? zone.wet : clamp(0.15 + t * 0.30, 0.10, 0.80);

    return {
        wet,
        room,
        damp: mat.damp,
        width: 1.0,
        rt60: t,
        volume,
        surface,
        material: zone.material || 'concrete',
    };
}

/** Какая зона накрывает точку (позже добавленные важнее). */
export function zoneAt(zones, x, y) {
    let found = null;
    for (const [name, z] of zones) {
        const r = z.rect;
        if (!r) continue;
        if (x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) found = { name, zone: z };
    }
    return found;
}

function clamp(v, lo, hi) {
    if (!(v >= lo)) return lo;
    if (v > hi) return hi;
    return v;
}

function pointOf(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const n = query(what)[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (what.nodes) {
        const n = what.nodes[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (what.tag) return { x: what.x, y: what.y };
    if (typeof what.x === 'number') return { x: what.x, y: what.y };
    return null;
}

// --- Установка ---------------------------------------------------------------

export function installAcoustics($) {
    const audio = ctx.audio;
    if (!audio) return null;

    audio.room = function (opts) {
        if (opts === undefined) {
            const r = engine.audio.getRoom ? engine.audio.getRoom() : null;
            return r || Object.assign({}, state.current);
        }
        const o = opts || {};
        state.auto = o.auto === undefined ? state.auto : !!o.auto;
        const target = {
            wet: o.wet === undefined ? 0.3 : o.wet,
            room: o.room === undefined ? 0.5 : o.room,
            damp: o.damp === undefined ? 0.5 : o.damp,
            width: o.width === undefined ? 1 : o.width,
        };
        // Ручная установка мгновенная: игру это касается напрямую.
        state.current = Object.assign({}, target);
        state.applied = Object.assign({}, target);
        state.target = Object.assign({}, target);
        state.active = null;
        engine.audio.setRoom(target.wet, target.room, target.damp, target.width);
        return audio;
    };

    audio.zone = function (name, opts) {
        if (name === undefined) return Array.from(state.zones.keys());
        if (opts === undefined) {
            const z = state.zones.get(name);
            return z ? Object.assign({}, z) : null;
        }
        const o = opts || {};
        const rect = o.rect || (o.at ? [o.at[0], o.at[1], o.w || 100, o.h || 100] : null);
        if (!rect) {
            ctx.log(`$: $.audio.zone("${name}") — нужен rect: [x, y, w, h]`);
            return audio;
        }
        state.zones.set(name, {
            rect: [rect[0], rect[1], rect[2], rect[3]],
            height: o.height === undefined ? 3 : o.height,
            material: o.material || 'concrete',
            wet: o.wet,
            smooth: o.smooth,
        });
        return audio;
    };

    audio.removeZone = function (name) {
        state.zones.delete(name);
        return audio;
    };

    /**
     * Слушателя здесь НЕ переопределяем: единственный владелец — $.audio
     * из audiobus.js (он умеет точку, узел и селектор). Акустика только
     * спрашивает у него точку прослушивания.
     */
    function listenerPoint() {
        if (audio.listener) {
            const p = audio.listener();
            if (p && typeof p.x === 'number') return p;
        }
        return ctx.camera ? ctx.camera.pos() : { x: 0, y: 0 };
    }
    state.listenerPoint = listenerPoint;
    /** Автоматическая комната по зонам: выключить — значит рулить $.audio.room(). */
    audio.acoustics = function (flag) {
        if (flag === undefined) return state.auto;
        state.auto = !!flag;
        return audio;
    };

    /** Глушить ли источники за стенами. */
    /**
     * Препятствия для звука: список точек (или узлов/селекторов). Чем больше
     * их лежит рядом с линией «слушатель → источник», тем глуше звучит
     * выстрел; на открытом месте фильтр не трогаем.
     *
     * ```js
     * $.audio.obstacles($.find('.tree'));          // все деревья
     * $.audio.obstacles([{x, y}, {x, y}]);        // просто точки
     * $.audio.damping({ radius: 34, strength: 0.3 });
     * ```
     */
    audio.obstacles = function (list, opts) {
        if (list === undefined) return state.obstacles.map((o) => ({ x: o.x, y: o.y }));
        const points = pointListOf(list);
        state.obstacles = points;
        if (opts) audio.damping(opts);
        return state.obstacles.length;
    };

    /** Настройка глушения: радиус, сила, предел, срезы фильтра. */
    audio.damping = function (opts) {
        if (opts === undefined) {
            return {
                radius: state.obstacle_radius,
                strength: state.obstacle_strength,
                max: state.obstacle_max,
                cutoff_clear: state.cutoff_clear,
                cutoff_dense: state.cutoff_dense,
            };
        }
        if (opts.radius !== undefined) state.obstacle_radius = Math.max(1, Number(opts.radius) || 1);
        if (opts.strength !== undefined) state.obstacle_strength = Math.max(0, Number(opts.strength) || 0);
        if (opts.max !== undefined) state.obstacle_max = Math.min(1, Math.max(0, Number(opts.max) || 0));
        if (opts.cutoff_clear !== undefined) state.cutoff_clear = Math.max(200, Number(opts.cutoff_clear) || 200);
        if (opts.cutoff_dense !== undefined) state.cutoff_dense = Math.max(120, Number(opts.cutoff_dense) || 120);
        return audio.damping();
    };

    /** Сколько препятствий вокруг точки (для HUD и отладки). */
    audio.densityAt = function (x, y, radius) {
        const r = radius === undefined ? state.obstacle_radius * 6 : radius;
        let n = 0;
        for (const o of state.obstacles) if (Math.hypot(o.x - x, o.y - y) <= r) n++;
        return n;
    };

    audio.occlusion = function (flag) {
        if (flag === undefined) return state.occlusion;
        state.occlusion = !!flag;
        return audio;
    };

    /** Снимок состояния — для отладки и агентских тестов. */
    audio.acousticsState = function () {
        return {
            auto: state.auto,
            occlusion: state.occlusion,
            zone: state.active,
            listener: state.listenerPoint ? state.listenerPoint() : null,
            room: Object.assign({}, state.current),
            zones: Array.from(state.zones.keys()),
        };
    };

    return audio;
}

// --- Кадр --------------------------------------------------------------------

export function tickAcoustics(dt) {
    if (!ctx.audio) return;

    // 1. Комната: зона под слушателем (или камера, если слушатель не задан).
    if (state.auto) {
        const pos = state.listenerPoint ? state.listenerPoint() : { x: 0, y: 0 };
        const hit = zoneAt(state.zones, pos.x, pos.y);
        const target = hit ? reverbForZone(hit.zone) : OUTDOOR;

        state.active = hit ? hit.name : null;
        state.target = {
            wet: target.wet,
            room: target.room,
            damp: target.damp,
            width: target.width,
        };

        // Экспоненциальное сглаживание: на границе зон параметры едут, а не щёлкают.
        const smooth = hit && hit.zone.smooth !== undefined ? hit.zone.smooth : state.smooth;
        const k = smooth > 0 ? Math.min(1, dt / Math.max(0.001, smooth)) : 1;
        for (const key of ['wet', 'room', 'damp', 'width']) {
            state.current[key] += (state.target[key] - state.current[key]) * k;
        }
        applyRoom();
    }

    tickSources();
}

function applyRoom() {
    const c = state.current;
    const a = state.applied;
    // Дёргаем движок только когда параметр заметно сдвинулся: вызов из кадра
    // дешёвый, но незачем делать его 60 раз в секунду впустую.
    if (Math.abs(c.wet - a.wet) < 0.002 && Math.abs(c.room - a.room) < 0.002
        && Math.abs(c.damp - a.damp) < 0.002 && Math.abs(c.width - a.width) < 0.002) {
        return;
    }
    engine.audio.setRoom(c.wet, c.room, c.damp, c.width);
    a.wet = c.wet; a.room = c.room; a.damp = c.damp; a.width = c.width;
}

/**
 * Живые источники: $.sound.playAt запоминает канал и точку, а здесь мы
 * пересчитываем панораму/громкость относительно слушателя и глушим то, что
 * ушло за стену.
 */
/** Точка/узел/селектор → {x, y}; список приводим к точкам один раз. */
function pointListOf(list) {
    const out = [];
    const push = (item) => {
        const p = pointOf(item);
        if (p) out.push({ x: p.x, y: p.y });
    };
    if (Array.isArray(list)) { for (const item of list) push(item); }
    else if (list && typeof list.forEach === 'function' && typeof list.length === 'number') {
        list.forEach((item) => push(item));
    } else push(list);
    return out;
}

/**
 * Насколько звук глушится препятствиями на отрезке: 0 — открытое место,
 * ближе к obstacle_max — глухая чаща.
 */
export function obstacleMuffle(a, b) {
    const list = state.obstacles;
    if (!list || list.length === 0) return 0;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return 0;

    const r = state.obstacle_radius;
    let hits = 0;
    for (const o of list) {
        let t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / len2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        if (Math.hypot(o.x - px, o.y - py) <= r) hits++;
    }
    return Math.min(state.obstacle_max, hits * state.obstacle_strength);
}

function tickSources() {
    const sources = ctx.sound_sources;
    if (!sources || sources.size === 0) return;
    if (!engine.audio.playing) return;

    const listener = state.listenerPoint ? state.listenerPoint() : { x: 0, y: 0 };

    for (const [channel, src] of Array.from(sources)) {
        if (!engine.audio.playing(channel)) { sources.delete(channel); continue; }
        const node = src.node ? pointOf(src.node) : null;
        if (node) { src.x = node.x; src.y = node.y; }

        const dx = src.x - listener.x;
        const dy = src.y - listener.y;
        const dist = Math.hypot(dx, dy);
        const spatial = ctx.audio_spatial === 'sdl';
        // В 3D-режиме и панораму, и затухание считает SDL_mixer — своими
        // руками их применять нельзя, получится двойное ослабление.
        const falloff = spatial ? 1 : Math.max(0, 1 - dist / src.max);
        if (!spatial) {
            const pan = Math.max(-1, Math.min(1, dx / Math.max(1, src.max * 0.5)));
            engine.audio.setChannelPan(channel, pan);
        }

        // Чаща глушит звук: сколько деревьев легло между источником и ухом.
        const muffle = obstacleMuffle(listener, { x: src.x, y: src.y });
        src.muffle = muffle;
        if (muffle > 0.001) {
            const cutoff = state.cutoff_clear
                + (state.cutoff_dense - state.cutoff_clear) * muffle;
            if (!spatial) engine.audio.setChannelVolume(channel, src.volume * falloff * (1 - muffle * 0.5));
            engine.audio.setChannelEffect(channel, 'lowpass', Math.round(cutoff), 0);
            continue;
        }

        if (state.occlusion && ctx.world && ctx.world.lineOfSight && dist > 1) {
            const open = ctx.world.lineOfSight({ x: listener.x, y: listener.y }, { x: src.x, y: src.y });
            if (!open) {
                // За стеной: глушим верх и слегка придавливаем.
                engine.audio.setChannelVolume(channel, src.volume * falloff * 0.55);
                engine.audio.setChannelEffect(channel, 'lowpass', 700, 0);
                continue;
            }
        }
        engine.audio.setChannelVolume(channel, src.volume * falloff);
        engine.audio.setChannelEffect(channel, 'none', 0, 0);
    }
}

/** Сброс при смене сцены: зоны и слушатель принадлежат сцене. */
export function resetAcoustics() {
    state.zones.clear();
    state.active = null;
    state.current = { wet: 0, room: 0.5, damp: 0.5, width: 1 };
    state.applied = { wet: -1, room: -1, damp: -1, width: -1 };
    state.obstacles = [];
    if (ctx.sound_sources) ctx.sound_sources.clear();
}

export const acousticsState = state;
