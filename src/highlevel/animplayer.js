// ===========================================================================
// Анимационный плеер: $.anim.player(), таймлайны в миллисекундах, микширование.
//
// Аналог AnimationPlayer в Godot 4 — 2D и в духе $:
//
//   $.anim.clip('run', {
//       duration: 600,
//       loop: 'loop',
//       tracks: [
//           { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } },
//                                      { t: 600, v: { x: 120, y: 0 }, ease: 'quadOut' }] },
//           { type: 'alpha',    keys: [{ t: 0, v: 1 }, { t: 600, v: 0.6 }] },
//           { type: 'sprite',   fps: 12, from: 0, to: 5 },
//           { type: 'value',    name: 'stamina', keys: [{ t: 0, v: 100 }, { t: 600, v: 40 }] },
//           { type: 'event',    keys: [{ t: 300, name: 'step', call: () => $.sound.play('step') }] },
//       ],
//   });
//   $.anim.player('hero').target('#hero').play('run');
//   $.anim.player('hero').on('step', () => $.log('шаг'));
//   $.anim.player('hero').blend('walk', 'run', 0.5);   // кроссфейд двух клипов
//
// Чем это отличается от $.anim.define()/.playClip() (anim.js) — подсистемы
// независимы и не мешают друг другу:
//   * время дорожки задаётся в миллисекундах от начала клипа (в anim.js — доли 0..1);
//   * дорожка описывается типом (position/scale/rotation/alpha/color/sprite/
//     value/event), а не именем свойства узла;
//   * у клипа есть собственный плеер с часами: seek, speed, loop, пауза,
//     микширование двух клипов;
//   * события — это ключи дорожки: колбэк или подписка (аналог Call Method
//     Track в Godot).
// Реестр клипов у плеера свой ($.anim.clip), реестр anim.js ($.anim.define)
// не трогается: форматы клипов разные, и подменять один другим нельзя.
//
// Детерминизм: единственный источник времени — dt игрового кадра
// (tickAnimPlayer). Ни Date.now(), ни performance.now(), ни Math.random() в
// модуле нет, поэтому прогон в режиме --fixed-dt повторяется кадр в кадр.
// Логика (сэмплирование ключей, фаза, события, микширование) вынесена в
// чистые экспортируемые функции — их проверяет tests/js/animplayer_test.mjs
// без движка.
// ===========================================================================

import { ctx, query, packColor } from './core.js';
import { easeFunction } from './tween.js';
import { chooseEase } from './anim.js';

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

const LOOPS = ['once', 'loop', 'pingpong'];
const EPS = 1e-9;
const DEFAULT_PLAYER = 'main';

/** Имя типа дорожки по синониму: 'angle' → 'rotation', 'opacity' → 'alpha'… */
const TYPE_ALIASES = {
    position: 'position', pos: 'position', move: 'position', translate: 'position',
    x: 'position', y: 'position',
    scale: 'scale', size: 'scale',
    rotation: 'rotation', angle: 'rotation', rotate: 'rotation',
    alpha: 'alpha', opacity: 'alpha', fade: 'alpha',
    color: 'color', colour: 'color', tint: 'color',
    sprite: 'sprite', frame: 'sprite', frames: 'sprite', anim: 'sprite',
    value: 'value', number: 'value', num: 'value',
    event: 'event', events: 'event', call: 'event', signal: 'event',
};

const TYPE_LIST = 'position|scale|rotation|alpha|color|sprite|value|event';

function isObject(value) {
    return !!value && typeof value === 'object';
}

/** Число из ключа дорожки; нечисло — ошибка с подсказкой, а не тихий ноль. */
function asNumber(value, what) {
    const n = Number(value);
    if (!isFinite(n)) {
        throw new Error(`$.anim.clip: в ключе ${what} нужно число (получено ${JSON.stringify(value)})`);
    }
    return n;
}

/** Копия значения ключа: смешивание не должно портить сами ключи клипа. */
export function cloneValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (isObject(value)) return Object.assign({}, value);
    return value;
}

/**
 * Линейная интерполяция значений ключа: число, вектор/объект или цвет-массив.
 * Функция чистая и экспортируется: на ней стоит вся выборка между ключами.
 */
export function lerpValue(a, b, k) {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
    if (isObject(a) && isObject(b)) {
        if (Array.isArray(a)) {
            const out = new Array(a.length);
            for (let i = 0; i < a.length; i++) {
                const av = a[i];
                const bv = b[i] === undefined ? av : b[i];
                out[i] = (typeof av === 'number' && typeof bv === 'number')
                    ? av + (bv - av) * k : (k < 1 ? av : bv);
            }
            return out;
        }
        const out = {};
        for (const key of Object.keys(a)) {
            const av = a[key];
            const bv = b[key] === undefined ? av : b[key];
            out[key] = (typeof av === 'number' && typeof bv === 'number')
                ? av + (bv - av) * k : (k < 1 ? av : bv);
        }
        return out;
    }
    // Разнотипные ключи интерполировать нечем: до конца участка держим левый.
    return k < 1 ? a : b;
}

// ---------------------------------------------------------------------------
// Цвет: упакованный RGBA ↔ покомпонентный массив
//
// Формат совпадает с engine.rgba() и R2D_RGBA в C: байты R,G,B,A от младшего
// к старшему. Дорожка цвета хранит каналы массивом [r,g,b,a], иначе линейная
// интерполяция «перетекала» бы между каналами.
// ---------------------------------------------------------------------------

export function unpackRgba(packed) {
    return [packed & 0xff, (packed >>> 8) & 0xff, (packed >>> 16) & 0xff, (packed >>> 24) & 0xff];
}

export function packRgba(rgba) {
    const r = Math.max(0, Math.min(255, Math.round(rgba[0] || 0)));
    const g = Math.max(0, Math.min(255, Math.round(rgba[1] || 0)));
    const b = Math.max(0, Math.min(255, Math.round(rgba[2] || 0)));
    const a = Math.max(0, Math.min(255, Math.round(rgba[3] === undefined ? 255 : rgba[3])));
    return (r | (g << 8) | (b << 16) | (a << 24)) | 0;
}

// ---------------------------------------------------------------------------
// Разбор объявления клипа
// ---------------------------------------------------------------------------

/**
 * Тип дорожки по объявлению. Без явного `type` тип угадывается по `prop`
 * (x/y/scale/angle/alpha/color/sprite — привычные имена) или по ключам:
 * ключ с `name` вместо `v` — событие, всё прочее — произвольное значение.
 */
export function trackType(raw) {
    if (raw.type !== undefined && raw.type !== null) {
        const named = TYPE_ALIASES[String(raw.type).toLowerCase()];
        if (!named) {
            throw new Error(`$.anim.clip: неизвестный type дорожки "${raw.type}" — допустимо ${TYPE_LIST}`);
        }
        return named;
    }
    if (typeof raw.prop === 'string') {
        return TYPE_ALIASES[raw.prop.toLowerCase()] || 'value';
    }
    if (Array.isArray(raw.keys) && raw.keys.length > 0) {
        const first = raw.keys[0];
        if (isObject(first) && first.v === undefined && first.name !== undefined) return 'event';
        return 'value';
    }
    if (raw.at !== undefined || raw.name !== undefined) return 'event';
    return null;
}

/** Канонический вид значения ключа: число, {x,y}, [r,g,b,a] или индекс кадра. */
export function canonicalKeyValue(type, axis, key) {
    const v = key.v;
    if (type === 'position') {
        if (axis) return asNumber(v, `дорожки position.${axis}`);
        if (Array.isArray(v)) return { x: asNumber(v[0], 'position.x'), y: asNumber(v[1], 'position.y') };
        if (isObject(v)) return { x: asNumber(v.x, 'position.x'), y: asNumber(v.y, 'position.y') };
        if (key.x !== undefined || key.y !== undefined) {
            return { x: asNumber(key.x === undefined ? 0 : key.x, 'position.x'),
                     y: asNumber(key.y === undefined ? 0 : key.y, 'position.y') };
        }
        const n = asNumber(v, 'дорожки position');
        return { x: n, y: n };
    }
    if (type === 'scale') {
        if (Array.isArray(v)) return { x: asNumber(v[0], 'scale.x'), y: asNumber(v[1], 'scale.y') };
        if (isObject(v)) return { x: asNumber(v.x, 'scale.x'), y: asNumber(v.y, 'scale.y') };
        const n = asNumber(v, 'дорожки scale');
        return { x: n, y: n };
    }
    if (type === 'color') return unpackRgba(packColor(v));
    if (type === 'sprite') return asNumber(v, 'дорожки sprite (индекс кадра)');
    return asNumber(v, `дорожки ${type}`);
}

/**
 * Ключи дорожки в каноническом виде: `t` — миллисекунды от начала клипа,
 * значения приведены к типу дорожки, ключи отсортированы по времени.
 */
export function normalizeTimelineKeys(keys, duration, type, raw) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    const axis = raw && raw.axis ? String(raw.axis) : null;
    const out = keys.map((key) => {
        if (!isObject(key)) {
            throw new Error('$.anim.clip: ключ дорожки — объект { t, v, ease? } (t в миллисекундах)');
        }
        const rawT = key.t !== undefined ? key.t : (key.time !== undefined ? key.time : key.at);
        let t = Number(rawT);
        if (!isFinite(t)) t = 0;
        if (t < 0) t = 0;
        if (duration > 0 && t > duration) t = duration;
        return { t, v: canonicalKeyValue(type, axis, key), ease: key.ease };
    });
    out.sort((a, b) => a.t - b.t);
    // Типичная опечатка: время задали долями (0..1), как в anim.js. Клип при
    // этом «стоит» — лучше сказать об этом в журнале, чем искать причину.
    if (duration > 2 && out.length > 1 && out[out.length - 1].t <= 1) {
        ctx.log(`$.anim.clip: у дорожки "${type}" все t <= 1, а duration = ${duration} мс — `
            + 'похоже, время задано в долях; в плеере t — миллисекунды');
    }
    return out;
}

/** Событие клипа: `{ at, name, data, call }`, `at` — миллисекунды. */
export function normalizeEvent(raw, duration) {
    if (!isObject(raw)) return null;
    const rawAt = raw.at !== undefined ? raw.at : (raw.t !== undefined ? raw.t : raw.time);
    let at = Number(rawAt);
    if (!isFinite(at)) at = 0;
    if (at < 0) at = 0;
    if (duration > 0 && at > duration) at = duration;
    const call = typeof raw.call === 'function' ? raw.call
        : (typeof raw.fn === 'function' ? raw.fn : null);
    const name = raw.name !== undefined ? String(raw.name) : (call ? 'call' : 'event');
    return { at, name, data: raw.data, call };
}

/** Одна дорожка клипа в каноническом виде (или null, если она пустая). */
export function normalizeTimelineTrack(raw, duration, clipName) {
    if (!isObject(raw)) return null;
    const type = trackType(raw);
    if (!type) {
        ctx.log(`$.anim.clip: дорожка в "${clipName}" без type и без ключей — пропускаю`);
        return null;
    }
    if (type === 'event') {
        const source = Array.isArray(raw.keys) && raw.keys.length > 0 ? raw.keys : [raw];
        const events = [];
        for (const item of source) {
            const ev = normalizeEvent(item, duration);
            if (ev) events.push(ev);
        }
        if (events.length === 0) {
            ctx.log(`$.anim.clip: дорожка-событие в "${clipName}" без ключей — пропускаю`);
            return null;
        }
        return { type: 'event', events };
    }

    const isPropFallback = raw.type === undefined && typeof raw.prop === 'string'
        && TYPE_ALIASES[raw.prop.toLowerCase()] === undefined;
    let axis = null;
    if (type === 'position') {
        const wanted = raw.axis ? String(raw.axis)
            : (raw.prop === 'x' || raw.prop === 'y' ? raw.prop : null);
        if (wanted === 'x' || wanted === 'y') axis = wanted;
        else if (wanted) {
            ctx.log(`$.anim.clip: у дорожки position неизвестная ось "${wanted}" — пишу обе (x, y)`);
        }
    }
    const keys = normalizeTimelineKeys(raw.keys, duration, type, { axis });
    const isFpsSprite = type === 'sprite' && Number(raw.fps) > 0;
    if (keys.length === 0 && !isFpsSprite) {
        ctx.log(`$.anim.clip: дорожка "${type}" в "${clipName}" без ключей — пропускаю`);
        return null;
    }

    let key;
    if (type === 'position') key = axis || 'position';
    else if (type === 'value') key = String(raw.name !== undefined ? raw.name
        : (raw.key !== undefined ? raw.key : (raw.prop !== undefined ? raw.prop : 'value')));
    else key = type;

    return {
        type,
        key,
        axis,
        keys,
        from: raw.from === undefined ? 0 : Math.max(0, Math.floor(Number(raw.from) || 0)),
        to: raw.to === undefined ? -1 : Math.floor(Number(raw.to)),
        fps: Number(raw.fps) > 0 ? Number(raw.fps) : 0,
        once: raw.once === true,
        // Произвольное значение по умолчанию живёт только в плеере
        // (player.value('hp')); attr: true дополнительно пишет его в node.attrs,
        // чтобы работали селекторы вида [hp<20].
        attr: raw.attr !== undefined ? !!raw.attr : isPropFallback,
    };
}

/**
 * Проверка и нормализация объявления клипа плеера.
 * spec: { duration (мс, обязательно), loop, speed, tracks, events }.
 */
export function normalizeTimeline(name, spec) {
    const clipName = String(name);
    const src = spec || {};
    const duration = Number(src.duration);
    if (!(duration > 0)) {
        throw new Error(`$.anim.clip: у клипа "${clipName}" нужен duration > 0 (мс) — `
            + 'например { duration: 1000, tracks: [{ type: "alpha", keys: [...] }] }');
    }
    const loop = src.loop === undefined ? 'once' : src.loop;
    if (LOOPS.indexOf(loop) < 0) {
        throw new Error(`$.anim.clip: у клипа "${clipName}" неверный loop "${loop}" — `
            + 'допустимо once|loop|pingpong');
    }
    const rawSpeed = src.speed === undefined ? 1 : Number(src.speed);
    const speed = isFinite(rawSpeed) && rawSpeed >= 0 ? rawSpeed : 1;

    const tracks = [];
    const events = [];
    const busy = new Set();
    for (const raw of (src.tracks || [])) {
        const track = normalizeTimelineTrack(raw, duration, clipName);
        if (!track) continue;
        if (track.type === 'event') {
            for (const ev of track.events) events.push(ev);
            continue;
        }
        if (busy.has(track.key)) {
            ctx.log(`$.anim.clip: в клипе "${clipName}" две дорожки пишут в "${track.key}" — `
                + 'играет последняя');
        }
        busy.add(track.key);
        tracks.push(track);
    }
    for (const raw of (src.events || [])) {
        const ev = normalizeEvent(raw, duration);
        if (ev) events.push(ev);
    }
    events.sort((a, b) => a.at - b.at);

    return { name: clipName, duration, loop, speed, tracks, events };
}

// ---------------------------------------------------------------------------
// Чистая логика: выборка ключей, фаза, события, микширование
// ---------------------------------------------------------------------------

/**
 * Плавность участка: готовая функция, короткое имя ('quadOut') или
 * линейность по умолчанию. Таблица кривых живёт в tween.js, перевод коротких
 * имён ('quadOut' → 'easeOutQuad') — в anim.js: своей таблицы модуль не заводит,
 * чтобы плеер, клипы anim.js и твины не разъезжались.
 */
export function playerEase(ease) {
    if (typeof ease === 'function') return ease;
    if (ease === undefined || ease === null) return easeFunction('linear');
    return chooseEase(ease);
}

/**
 * Значение дорожки на момент `timeMs` (миллисекунды от начала клипа).
 *
 * Плавность берётся у ключа-назначения (правого), а если её там нет — у
 * левого: так работают обе привычные записи (ease «на приезде» и «на выезде»).
 * До первого и после последнего ключа значение держится, а не зануляется.
 */
export function sampleKeysAt(keys, timeMs) {
    if (!Array.isArray(keys) || keys.length === 0) return 0;
    if (keys.length === 1) return cloneValue(keys[0].v);
    const t = Number(timeMs);
    const time = isFinite(t) ? t : 0;
    if (time <= keys[0].t) return cloneValue(keys[0].v);
    const last = keys[keys.length - 1];
    if (time >= last.t) return cloneValue(last.v);
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (time >= a.t && time <= b.t) {
            const span = b.t - a.t;
            if (!(span > 0)) return cloneValue(b.v);       // два ключа в одной точке
            const local = (time - a.t) / span;
            const ease = playerEase(b.ease !== undefined ? b.ease : a.ease);
            return lerpValue(a.v, b.v, ease(local));
        }
    }
    return cloneValue(last.v);
}

/**
 * Положение playhead внутри клипа: `{ position, phase, cycle, ended }`.
 * once — упирается в конец, loop — пила, pingpong — треугольник.
 * Чистая функция: на ней стоят и выборка значений, и конец клипа.
 */
export function playheadState(timeMs, duration, loop) {
    const d = duration > 0 ? duration : 1;
    const t = Number(timeMs) > 0 ? Number(timeMs) : 0;
    if (loop === 'loop') {
        const cycle = Math.floor(t / d);
        const position = t - cycle * d;
        return { position, phase: position / d, cycle, ended: false };
    }
    if (loop === 'pingpong') {
        const cycle = Math.floor(t / (2 * d));
        const p = t - cycle * 2 * d;
        const position = p <= d ? p : 2 * d - p;
        return { position, phase: position / d, cycle, ended: false };
    }
    const position = t >= d ? d : t;
    return { position, phase: position / d, cycle: 0, ended: t >= d };
}

/**
 * Индекс кадра для дорожки `sprite` на момент `timeMs`.
 *
 * Два способа: ключи (значение ключа — абсолютный индекс в `node.frames`)
 * либо `fps` (кадры листаются по кругу в диапазоне from..to). Если кадров у
 * узла нет (`frameCount = 0`), диапазон не ограничивается — индекс всё равно
 * осмысленный.
 */
export function spriteFrameAt(track, timeMs, frameCount) {
    const total = frameCount > 0 ? Math.floor(frameCount) : 0;
    const unlimited = total === 0;
    const last = unlimited ? 0 : total - 1;
    const from = track.from > 0 ? Math.floor(track.from) : 0;
    let to;
    if (track.to >= 0) to = Math.floor(track.to);
    else to = unlimited ? Number.POSITIVE_INFINITY : last;
    if (!unlimited && to > last) to = last;
    if (to < from) to = from;
    const span = to - from + 1;

    if (Array.isArray(track.keys) && track.keys.length > 0) {
        const index = Math.round(sampleKeysAt(track.keys, timeMs));
        return unlimited ? Math.max(0, index) : Math.max(0, Math.min(last, index));
    }
    const fps = track.fps > 0 ? track.fps : 0;
    if (!fps) return from;
    const step = Math.floor((timeMs / 1000) * fps);
    if (track.once) return from + Math.min(step, span - 1);
    return from + ((step % span) + span) % span;
}

/**
 * Значения всех дорожек клипа на момент `timeMs`:
 * `{ position: {x,y}, alpha: 0.5, sprite: { frame: 3 }, stamina: 42, … }`.
 * Кадр спрайта отдаётся объектом `{ frame }`, а не id спрайта: id зависит от
 * узла, а индекс — от клипа.
 */
export function timelineValuesAt(timeline, timeMs, frameCount) {
    const values = {};
    if (!timeline) return values;
    for (const track of timeline.tracks) {
        if (track.type === 'sprite') values[track.key] = { frame: spriteFrameAt(track, timeMs, frameCount) };
        else values[track.key] = sampleKeysAt(track.keys, timeMs);
    }
    return values;
}

/**
 * События, попавшие в интервал времени `(fromMs, toMs]`, с учётом цикла.
 *
 * Для loop/pingpong событие повторяется каждый проход: его моменты — это
 * `at + n * duration`. Интервал полуоткрытый, поэтому в кадре, где время
 * дошло ровно до события, оно срабатывает ровно один раз, а на следующем
 * кадре уже нет.
 */
export function eventsBetweenTimes(events, fromMs, toMs, duration, loop) {
    const out = [];
    if (!Array.isArray(events) || events.length === 0) return out;
    if (!(toMs > fromMs)) return out;
    const d = duration > 0 ? duration : 0;
    const periodic = (loop === 'loop' || loop === 'pingpong') && d > 0;
    for (const ev of events) {
        const at = ev.at;
        if (!isFinite(at)) continue;
        let moment;
        if (periodic) {
            const steps = Math.max(0, Math.ceil((fromMs - at) / d - EPS));
            moment = at + steps * d;
        } else {
            moment = at;
        }
        // Предохранитель от мусорного at (например, -1e9) — как в anim.js.
        // Для once точка ровно одна: цикл нужен только для loop/pingpong.
        for (let guard = 0; guard < 1000; guard++) {
            if (moment > toMs + EPS) break;
            if (moment > fromMs + EPS) out.push({ ev, moment });
            if (!periodic) break;
            moment += d;
        }
    }
    out.sort((a, b) => a.moment - b.moment);
    return out.map((entry) => entry.ev);
}

/**
 * Смешивание значений нескольких клипов по весам.
 *
 * Числа, векторы и цвета складываются покомпонентно и нормируются на сумму
 * весов: дорожка, объявленная только в одном клипе, получает полный вес, а не
 * «половину». Дискретные дорожки (кадр спрайта — их имена передают в
 * `discrete`) берутся у клипа с большим весом: промежуточного кадра не
 * бывает. При равных весах выигрывает клип, идущий раньше в списке.
 */
export function blendValues(entries, discrete) {
    const list = (entries || []).filter((e) => e && e.values && e.weight > 0);
    if (list.length === 0) return {};
    if (list.length === 1) {
        const only = {};
        for (const key of Object.keys(list[0].values)) only[key] = cloneValue(list[0].values[key]);
        return only;
    }
    const skip = new Set(discrete || []);
    const keys = new Set();
    for (const e of list) for (const key of Object.keys(e.values)) keys.add(key);

    const out = {};
    for (const key of keys) {
        let total = 0;
        let best = null;
        let bestWeight = -1;
        let template = null;
        let allNumbers = true;
        let allObjects = true;
        for (const e of list) {
            const value = e.values[key];
            if (value === undefined) continue;
            if (template === null) template = value;
            if (typeof value !== 'number') allNumbers = false;
            if (!isObject(value)) allObjects = false;
            if (e.weight > bestWeight) { bestWeight = e.weight; best = value; }
            total += e.weight;
        }
        if (template === null) continue;
        if (skip.has(key) || !(allNumbers || allObjects)) {
            out[key] = cloneValue(best);
            continue;
        }
        if (allNumbers) {
            let sum = 0;
            for (const e of list) if (e.values[key] !== undefined) sum += e.values[key] * e.weight;
            out[key] = total > 0 ? sum / total : cloneValue(best);
            continue;
        }
        out[key] = blendObjects(list, key, template);
    }
    return out;
}

/** Покомпонентное смешивание объектов (вектор позиции, RGBA-массив). */
function blendObjects(list, key, template) {
    const out = cloneValue(template);
    const indices = Array.isArray(template)
        ? template.map((_, i) => i)
        : Object.keys(template);
    for (const index of indices) {
        let sum = 0;
        let weight = 0;
        let numeric = true;
        for (const e of list) {
            const value = e.values[key];
            if (value === undefined) continue;
            const component = value[index];
            if (typeof component !== 'number') { numeric = false; break; }
            sum += component * e.weight;
            weight += e.weight;
        }
        if (numeric && weight > 0) out[index] = sum / weight;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Применение значений к узлу
// ---------------------------------------------------------------------------

/**
 * Запись значения дорожки в узел. Позиция пишется в поля узла напрямую (тело
 * Box2D не переносится) — ровно как в anim.js: анимация не должна телепортить
 * физику.
 */
export function writeTrackValue(node, track, value) {
    if (!node || !track || value === undefined) return;
    switch (track.type) {
    case 'position':
        if (track.axis === 'x') { node.x = value; return; }
        if (track.axis === 'y') { node.y = value; return; }
        if (isObject(value)) { node.x = value.x; node.y = value.y; }
        return;
    case 'scale':
        if (typeof value === 'number') { node.scale_x = value; node.scale_y = value; return; }
        if (isObject(value)) { node.scale_x = value.x; node.scale_y = value.y; }
        return;
    case 'rotation':
        node.angle = value;
        return;
    case 'alpha':
        node.alpha = value;
        return;
    case 'color':
        node.color = packRgba(value);
        return;
    case 'sprite': {
        const frames = node.frames;
        if (!frames || frames.length === 0) return;    // кадров нет — писать нечего
        const index = Math.max(0, Math.min(frames.length - 1, Math.round(value.frame)));
        node.sprite = frames[index];
        node.frame_index = index;
        return;
    }
    case 'value':
        if (track.attr) node.attrs[track.key] = value;
        return;
    default:
        return;
    }
}

// ---------------------------------------------------------------------------
// Плеер
// ---------------------------------------------------------------------------

const timelines = new Map();      // имя → нормализованный клип плеера
const players = [];               // все созданные плееры, в порядке создания
const tick_list = [];             // снимок на кадр (обработчики могут менять список)
let default_player = null;

/** Событие плеера: и общее 'event', и под своим именем, и прямой вызов call. */
function emitPlayerEvent(player, layer, ev) {
    const payload = {
        name: ev.name,
        data: ev.data === undefined ? {} : ev.data,
        at: ev.at,
        clip: layer.timeline,
        clipName: layer.timeline.name,
        player,
    };
    dispatch(player, 'event', payload);
    if (ev.name && ev.name !== 'event') dispatch(player, ev.name, payload);
    if (typeof ev.call === 'function') {
        try { ev.call(payload); }
        catch (e) {
            ctx.log(`$.anim: ошибка в вызове события "${ev.name}" клипа `
                + `"${layer.timeline.name}": ${e}`);
        }
    }
}

function dispatch(player, name, payload) {
    const list = player.listeners.get(name);
    if (!list || list.length === 0) return;
    for (const fn of list.slice()) {
        try { fn(payload); }
        catch (e) { ctx.log(`$.anim: ошибка в обработчике "${name}" плеера "${player.name}": ${e}`); }
    }
}

/**
 * Анимационный плеер: часы, набор играющих клипов (слотов) и подписки.
 * Создаётся через `$.anim.player(name)`; вручную `new` не нужен, но класс
 * экспортируется — на нём стоят юнит-тесты.
 */
export class AnimPlayer {
    constructor(name) {
        this.name = String(name);
        this.slots = new Map();        // имя слота → { timeline, weight, loop, offset, onEnd }
        this.node = null;              // узел-цель (или null: значения только в values)
        this.clock = 0;                // часы плеера, мс; идут только вперёд
        this.speedValue = 1;
        this.loopValue = null;         // null — «как в клипе»
        this.pausedFlag = false;
        this.values_store = {};
        this.listeners = new Map();
        this.destroyed = false;
    }

    // --- цель --------------------------------------------------------------

    /** Узел-цель: узел, обёртка, селектор или '#id'. Без аргумента — геттер. */
    target(value) {
        if (value === undefined) return this.node;
        this.node = resolveTarget(value);
        if (!this.node && value !== null) {
            ctx.log(`$.anim: цель анимации "${value}" не найдена — проверьте id/селектор узла`);
        }
        return this;
    }

    // --- воспроизведение ----------------------------------------------------

    /**
     * Играть клип. opts: { slot, weight, loop, speed, restart, time, offset, onEnd }.
     *
     * Слот по умолчанию 'base' заменяет всё, что играло: у плеера одна
     * основная дорожка времени. Повторный play того же клипа не сбрасывает
     * время (как playClip в anim.js) — нужен сброс, `restart: true`.
     * Слот с другим именем добавляется к играющим: на этом стоит blend().
     */
    play(clip, opts) {
        const o = opts || {};
        const name = String(clip);
        const timeline = timelines.get(name);
        if (!timeline) {
            ctx.log(`$.anim.play: клип "${name}" не объявлен — сначала `
                + `$.anim.clip("${name}", { duration, tracks })`);
            return this;
        }
        const slot = o.slot === undefined ? 'base' : String(o.slot);
        if (slot === 'base') {
            const current = this.slots.get('base');
            if (o.restart !== true && current && current.timeline === timeline) return this;
            this.slots.clear();
            this.clock = o.time !== undefined ? Math.max(0, Number(o.time) || 0) : 0;
            this.pausedFlag = false;
        } else if (o.restart === true) {
            this.clock = o.time !== undefined ? Math.max(0, Number(o.time) || 0) : 0;
        } else if (o.time !== undefined) {
            this.clock = Math.max(0, Number(o.time) || 0);
        }
        const layer = this.addLayer(name, slot, o);
        if (!layer) return this;
        if (slot === 'base' && this.clock === 0) {
            // Событие at: 0 срабатывает сразу, не дожидаясь кадра: иначе
            // «стартовое» событие можно было бы пропустить, остановив плеер в
            // том же кадре. Старт с середины (opts.time) прошлые события не
            // доигрывает: это прыжок, а не проигрывание пропущенного.
            this.fireRange(layer, -1, 0);
        }
        this.applyValues();
        return this;
    }

    /** Внутреннее: добавить слой в слот (клип уже проверен вызывающим). */
    addLayer(name, slot, opts) {
        const o = opts || {};
        const timeline = timelines.get(String(name));
        if (!timeline) return null;
        let loop = o.loop === undefined ? this.loopValue : o.loop;
        if (loop === undefined || loop === null) loop = timeline.loop;
        if (loop === true) loop = 'loop';
        if (loop === false) loop = 'once';
        if (LOOPS.indexOf(loop) < 0) {
            ctx.log(`$.anim.play: неверный loop "${o.loop}" — беру "${timeline.loop}"`);
            loop = timeline.loop;
        }
        const speed = Number(o.speed);
        const layer = {
            timeline,
            slot,
            weight: o.weight === undefined ? 1 : Math.max(0, Number(o.weight) || 0),
            loop,
            offset: o.offset === undefined ? 0 : Number(o.offset) || 0,
            speed: isFinite(speed) && speed >= 0 ? speed : timeline.speed,
            onEnd: typeof o.onEnd === 'function' ? o.onEnd : null,
        };
        this.slots.set(slot, layer);
        return layer;
    }

    /**
     * Кроссфейд двух клипов: `t = 0` — только a, `t = 1` — только b.
     * Оба клипа идут с одних часов, поэтому кадры и события совпадают по
     * времени. Возвращает плеер.
     */
    blend(a, b, t, opts) {
        const k = Math.max(0, Math.min(1, Number(t) || 0));
        const o = opts || {};
        if (!timelines.has(String(a)) || !timelines.has(String(b))) {
            ctx.log(`$.anim.blend: клипы "${a}"/"${b}" должны быть объявлены `
                + '($.anim.clip) до кроссфейда');
            return this;
        }
        this.slots.clear();
        this.clock = o.time !== undefined ? Math.max(0, Number(o.time) || 0) : 0;
        this.pausedFlag = false;
        const optsA = Object.assign({}, o, { weight: 1 - k });
        const optsB = Object.assign({}, o, { weight: k });
        const layerA = this.addLayer(a, 'blend-a', optsA);
        const layerB = this.addLayer(b, 'blend-b', optsB);
        if (layerA && k < 1 && this.clock === 0) this.fireRange(layerA, -1, 0);
        if (layerB && k > 0 && this.clock === 0) this.fireRange(layerB, -1, 0);
        this.applyValues();
        return this;
    }

    /** Пауза/продолжение часов. */
    pause() { this.pausedFlag = true; return this; }
    resume() { this.pausedFlag = false; return this; }
    paused() { return this.pausedFlag; }

    /**
     * Остановка: без аргумента — всё и сброс часов, с именем клипа — только
     * этот клип. После остановки события клипа больше не приходят, значения
     * остаются в последнем состоянии (плеер не «телепортирует» узел назад).
     */
    stop(clipName) {
        if (clipName === undefined) {
            this.slots.clear();
            this.clock = 0;
            this.pausedFlag = false;
            this.values_store = {};
            return this;
        }
        const name = String(clipName);
        for (const [slot, layer] of Array.from(this.slots.entries())) {
            if (layer.timeline.name === name) this.slots.delete(slot);
        }
        return this;
    }

    /** Перемотка на `ms` от начала клипа. */
    seek(ms, opts) {
        const to = Math.max(0, Number(ms) || 0);
        const from = this.clock;
        this.clock = to;
        // По умолчанию перемотка события НЕ вызывает: это прыжок, а не
        // проигрывание пропущенного куска. Нужны события — { fire: true }.
        if (opts && opts.fire === true && to > from) {
            for (const layer of Array.from(this.slots.values())) this.fireRange(layer, from, to);
        }
        this.applyValues();
        return this;
    }

    /** Скорость часов: без аргумента — геттер. Отрицательная не поддерживается. */
    speed(value) {
        if (value === undefined) return this.speedValue;
        const n = Number(value);
        if (!isFinite(n) || n < 0) {
            ctx.log(`$.anim.speed: нужно число >= 0 (получено "${value}"); `
                + 'для движения назад используйте loop: "pingpong"');
            return this;
        }
        this.speedValue = n;
        return this;
    }

    /**
     * Режим повтора: true → 'loop', false → 'once', строка → как есть,
     * null → «как в клипе». Без аргумента — геттер текущего переопределения.
     */
    loop(value) {
        if (value === undefined) return this.loopValue;
        let next = value;
        if (value === true) next = 'loop';
        else if (value === false) next = 'once';
        else if (value === null) next = null;
        else next = String(value);
        if (next !== null && LOOPS.indexOf(next) < 0) {
            ctx.log(`$.anim.loop: неверный режим "${value}" — допустимо once|loop|pingpong, true/false`);
            return this;
        }
        this.loopValue = next;
        for (const layer of this.slots.values()) {
            layer.loop = next === null ? layer.timeline.loop : next;
        }
        return this;
    }

    /** Играет ли что-нибудь (на паузе — тоже true: клип не завершён). */
    playing() { return !this.destroyed && this.slots.size > 0; }

    /** Позиция внутри клипа, мс (0..duration). */
    time() {
        const layer = this.primary();
        if (!layer) return 0;
        return playheadState(layerTime(this, layer), layer.timeline.duration, layer.loop).position;
    }

    /** Часы плеера целиком, мс: растут без предела, включая все проходы. */
    total() { return this.clock; }

    /** Имя основного (первого) играющего клипа или null. */
    clip() {
        const layer = this.primary();
        return layer ? layer.timeline.name : null;
    }

    /** Список играющих клипов (у кроссфейда их два). */
    clipNames() {
        return Array.from(this.slots.values()).map((layer) => layer.timeline.name);
    }

    /** Значение дорожки `value` по имени; без дорожки — fallback (по умолчанию 0). */
    value(key, fallback) {
        const found = this.values_store[String(key)];
        if (found === undefined) return fallback === undefined ? 0 : fallback;
        return found;
    }

    /** Все значения последнего кадра: `{ alpha: 0.5, stamina: 42, … }`. */
    values() { return this.values_store; }

    /** Вес слота: без значения — геттер, с числом — задать (ручной кроссфейд). */
    weight(slot, value) {
        const layer = this.slots.get(String(slot));
        if (!layer) return 0;
        if (value === undefined) return layer.weight;
        layer.weight = Math.max(0, Number(value) || 0);
        return this;
    }

    /** Подписка. Возвращает функцию отписки — удобно снимать вручную. */
    on(name, fn) {
        if (typeof fn !== 'function') return () => {};
        const key = String(name);
        if (!this.listeners.has(key)) this.listeners.set(key, []);
        this.listeners.get(key).push(fn);
        return () => { this.off(key, fn); };
    }

    off(name, fn) {
        if (!name) { this.listeners.clear(); return this; }
        const key = String(name);
        if (!fn) { this.listeners.delete(key); return this; }
        const list = this.listeners.get(key);
        if (list) this.listeners.set(key, list.filter((f) => f !== fn));
        return this;
    }

    /** Плеер больше не тикает; часы и слоты очищаются, подписки снимаются. */
    destroy() {
        this.slots.clear();
        this.listeners.clear();
        this.values_store = {};
        this.clock = 0;
        this.node = null;
        this.destroyed = true;
        return this;
    }

    // --- внутреннее ---------------------------------------------------------

    /** Основной слой: базовый слот, иначе первый по порядку добавления. */
    primary() {
        return this.slots.get('base') || this.slots.values().next().value || null;
    }

    /** События слоя, попавшие в интервал часов плеера (со своим темпом слоя). */
    fireRange(layer, fromMs, toMs) {
        if (!layer || !(layer.weight > 0)) return;
        const k = layer.speed;
        if (!(k > 0)) return;
        const list = eventsBetweenTimes(
            layer.timeline.events,
            (fromMs - layer.offset) * k,
            (toMs - layer.offset) * k,
            layer.timeline.duration,
            layer.loop,
        );
        for (const ev of list) emitPlayerEvent(this, layer, ev);
    }

    /** Пересчитать значения всех слоёв и записать их в узел. */
    applyValues() {
        const frameCount = this.node && this.node.frames ? this.node.frames.length : 0;
        const meta = {};
        const entries = [];
        for (const layer of this.slots.values()) {
            if (!(layer.weight > 0)) continue;
            const state = playheadState(layerTime(this, layer), layer.timeline.duration, layer.loop);
            const values = timelineValuesAt(layer.timeline, state.position, frameCount);
            for (const track of layer.timeline.tracks) if (!meta[track.key]) meta[track.key] = track;
            entries.push({ values, weight: layer.weight });
        }
        const discrete = Object.keys(meta).filter((key) => meta[key].type === 'sprite');
        const merged = blendValues(entries, discrete);
        this.values_store = merged;
        if (!this.node) return merged;
        for (const key of Object.keys(merged)) writeTrackValue(this.node, meta[key], merged[key]);
        return merged;
    }
}

/** Локальное время слоя: часы плеера со сдвигом слота и темпом клипа. */
function layerTime(player, layer) {
    return (player.clock - layer.offset) * layer.speed;
}

/** Разрешение цели: узел, обёртка, '#id', селектор — или null. */
export function resolveTarget(value) {
    if (value === undefined || value === null) return null;
    if (value && Array.isArray(value.nodes)) return value.nodes[0] || null;
    if (typeof value === 'string') {
        const found = query(value);
        return found.length ? found[0] : null;
    }
    return value;
}

/** Плеер по имени (создаётся при первом обращении). */
export function getPlayer(name) {
    const key = String(name);
    for (const player of players) if (player.name === key) return player;
    const player = new AnimPlayer(key);
    players.push(player);
    return player;
}

/** Плеер по умолчанию — на него смотрят $.anim.play/stop/seek/speed/loop/… */
function defaultPlayer() {
    if (!default_player || default_player.destroyed) default_player = getPlayer(DEFAULT_PLAYER);
    return default_player;
}

/**
 * Продвинуть один плеер на `dtMs` миллисекунд: события, значения, концы
 * клипов. Экспортируется, чтобы юнит-тест мог прокрутить ровно один плеер,
 * не поднимая общий список.
 */
export function advancePlayer(player, dtMs) {
    if (!player || player.destroyed) return;
    if (!(dtMs > 0) || player.pausedFlag || player.slots.size === 0) return;
    const prev = player.clock;
    const k = player.speedValue;
    player.clock += dtMs * k;

    const layers = Array.from(player.slots.values());
    for (const layer of layers) player.fireRange(layer, prev, player.clock);
    player.applyValues();

    for (const layer of layers) {
        const state = playheadState(layerTime(player, layer), layer.timeline.duration, layer.loop);
        if (!state.ended) continue;
        if (player.slots.get(layer.slot) === layer) player.slots.delete(layer.slot);
        const payload = { clip: layer.timeline, clipName: layer.timeline.name, player };
        dispatch(player, 'finished', payload);
        if (layer.onEnd) {
            try { layer.onEnd(player); }
            catch (e) { ctx.log(`$.anim: ошибка в onEnd клипа "${layer.timeline.name}": ${e}`); }
        }
    }
}

/**
 * Шаг всех плееров; вызывается из api.js раз в кадр, сразу после tickAnim.
 *
 * Время берётся только отсюда (dt игрового кадра) — никаких Date.now(),
 * поэтому при --fixed-dt прогон воспроизводится кадр в кадр.
 */
export function tickAnimPlayer(dt) {
    if (!(dt > 0)) return;
    const ms = dt * 1000;
    tick_list.length = 0;
    for (let i = 0; i < players.length; i++) tick_list.push(players[i]);
    for (let i = 0; i < tick_list.length; i++) {
        const player = tick_list[i];
        if (player.destroyed) continue;
        if (player.node && player.node.removed) { player.stop(); continue; }
        advancePlayer(player, ms);
    }
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

/**
 * Дополняет существующее пространство `$.anim` (anim.js), ничего не заменяя:
 * реестр клипов плеера, фабрика плееров и фасад плеера по умолчанию.
 */
export function installAnimPlayer($) {
    const anim = $.anim || ($.anim = {});

    // --- реестр клипов плеера (отдельно от $.anim.define) ------------------
    /** Объявить клип плеера: { duration (мс), loop, speed, tracks, events }. */
    anim.clip = function (name, spec) {
        timelines.set(String(name), normalizeTimeline(name, spec));
        return $;
    };
    anim.clipGet = (name) => timelines.get(String(name)) || null;
    anim.clips = () => Array.from(timelines.keys());
    anim.removeClip = (name) => timelines.delete(String(name));
    anim.clearClips = () => { timelines.clear(); return $; };

    // --- плееры -------------------------------------------------------------
    anim.player = (name) => getPlayer(name === undefined ? DEFAULT_PLAYER : name);
    anim.players = () => players.map((player) => player.name);
    anim.defaultPlayer = () => defaultPlayer();
    anim.clearPlayers = () => {
        for (const player of players) player.destroy();
        players.length = 0;
        default_player = null;
        return anim;
    };

    // --- фасад плеера по умолчанию -----------------------------------------
    // Возвращают сам $.anim, чтобы выстраивались цепочки:
    // $.anim.target('#hero').play('run').speed(2)
    anim.target = (value) => { defaultPlayer().target(value); return anim; };
    anim.play = (name, opts) => { defaultPlayer().play(name, opts); return anim; };
    anim.blend = (a, b, t, opts) => { defaultPlayer().blend(a, b, t, opts); return anim; };
    anim.stop = (clipName) => { defaultPlayer().stop(clipName); return anim; };
    anim.stopAll = () => {
        for (const player of players.slice()) player.stop();
        return anim;
    };
    anim.seek = (ms, opts) => { defaultPlayer().seek(ms, opts); return anim; };
    anim.pause = () => { defaultPlayer().pause(); return anim; };
    anim.resume = () => { defaultPlayer().resume(); return anim; };
    anim.paused = () => defaultPlayer().paused();
    anim.speed = (value) => {
        if (value === undefined) return defaultPlayer().speed();
        defaultPlayer().speed(value);
        return anim;
    };
    anim.loop = (value) => {
        if (value === undefined) return defaultPlayer().loop();
        defaultPlayer().loop(value);
        return anim;
    };
    anim.playing = () => defaultPlayer().playing();
    anim.time = () => defaultPlayer().time();
    anim.totalTime = () => defaultPlayer().total();
    anim.clipName = () => defaultPlayer().clip();
    anim.value = (key, fallback) => defaultPlayer().value(key, fallback);
    anim.values = () => defaultPlayer().values();
    /** Подписка на события клипов плеера по умолчанию; возвращает отписку. */
    anim.on = (name, fn) => defaultPlayer().on(name, fn);
    anim.off = (name, fn) => { defaultPlayer().off(name, fn); return anim; };

    return $;
}
