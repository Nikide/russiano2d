// ===========================================================================
// Анимационный плеер: $.anim.player(), таймлайны в миллисекундах, микширование,
// мультицелевые дорожки (§41), маркеры/gameplay-окна (§10) и выбор часов (§6).
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
// Мультицелевые дорожки (§41). У дорожки есть target относительно корня плеера
// (`target().`), стабильный ID/path, typed binding и режим обновления. Один клип
// управляет кадром героя, оружием, сенсором атаки, эмиттером и звуком:
//
//   $.anim.player('hero').target('#hero').play('attack');   // корень плеера
//
//   tracks: [
//       { type: 'sprite', target: 'weapon', fps: 12 },                       // кадры оружия
//       { type: 'rotation', target: 'weapon', keys: [...] },                 // поворот оружия
//       { type: 'visible', target: 'weapon', keys: [{ t: 0, v: false }, { t: 120, v: true }] },
//       { type: 'shape.enabled', target: 'attack-sensor',                   // безопасная команда
//         keys: [{ t: 120, v: true }, { t: 260, v: false }] },
//       { type: 'emitter.emitting', target: 'muzzle', keys: [{ t: 120, v: true }] },
//       { type: 'light.intensity', target: 'muzzle-flash', keys: [{ t: 120, v: 3 }, { t: 200, v: 0 }] },
//       { type: 'audio', at: 120, resource: 'shot.ogg', bus: 'sfx', gain: 0.8,
//         envelope: [{ t: 120, v: 1 }, { t: 260, v: 0 }],
//         policy: { seek: 'skip', loop: 'fire' } },
//       { type: 'method', at: 120, name: 'camera.shake', data: { intensity: 6, ms: 140 } },
//       { type: 'event', at: 260, name: 'attack-end', window: 'attack', windowPhase: 'close' },
//   ]
//
// Чем это отличается от $.anim.define()/.playClip() (anim.js) — подсистемы
// независимы и не мешают друг другу:
//   * время дорожки задаётся в миллисекундах от начала клипа (в anim.js — доли 0..1);
//   * дорожка описывается типом (position/scale/rotation/alpha/color/sprite/
//     value/visible/bool/enum/emitter/shape/light/ui/audio/method/event), а не
//     именем свойства узла;
//   * у клипа есть собственный плеер с часами: seek, skip, speed, loop, пауза,
//     микширование двух клипов;
//   * события — это ключи дорожки: колбэк, подписка или зарегистрированное
//     действие (аналог Call Method Track в Godot).
// Реестр клипов у плеера свой ($.anim.clip), реестр anim.js ($.anim.define)
// не трогается: форматы клипов разные, и подменять один другим нельзя.
//
// Детерминизм: единственный источник времени — dt игрового кадра
// (tickAnimPlayer). Ни Date.now(), ни performance.now(), ни Math.random() в
// модуле нет, поэтому прогон в режиме --fixed-dt повторяется кадр в кадр.
// Логика (сэмплирование ключей, фаза, события, микширование, разрешение
// binding'ов) вынесена в чистые экспортируемые функции — их проверяет
// tests/js/animplayer_test.mjs без движка.
//
// Часы (§6): у плеера есть домен clock — 'simulation' (по умолчанию: тикает
// `$.time.delta()`, поэтому пауза/hit-stop его останавливают, как и раньше)
// или 'presentation' (тикает сырым временем кадра: продолжается на паузе и
// hit-stop, как VFX/камера). Старое поведение — clock: 'simulation'.
// ===========================================================================

import { ctx, query, packColor, wrapOne } from './core.js';
import { easeFunction } from './tween.js';
import { chooseEase } from './anim.js';
import { engine } from './native.js';

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

const LOOPS = ['once', 'loop', 'pingpong'];
const CLOCKS = ['simulation', 'presentation'];
const EPS = 1e-9;
const DEFAULT_PLAYER = 'main';

/**
 * Имя типа дорожки по синониму: 'angle' → 'rotation', 'opacity' → 'alpha'…
 * Новые типы §41: visible, bool, enum, emitter, shape, light, ui, audio, method.
 */
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
    // §41: дискретные состояния, property- и audio/method-дорожки
    visible: 'visible', show: 'visible', shown: 'visible',
    bool: 'bool', boolean: 'bool', flag: 'bool', toggle: 'bool',
    enum: 'enum', variant: 'enum', choice: 'enum', name: 'enum',
    emitter: 'emitter', emit: 'emitter',
    shape: 'shape', collider: 'shape', sensor: 'shape',
    light: 'light', lamp: 'light',
    ui: 'ui', rml: 'ui', rmlui: 'ui',
    // Полные имена binding'ов, у которых базовый тип однозначен:
    'shape.enabled': 'shape', 'emitter.emitting': 'emitter',
    'light.intensity': 'light', 'sprite.frame': 'sprite', 'ui.style': 'ui',
    audio: 'audio', sound: 'audio', sfx: 'audio', music: 'audio',
    method: 'method', action: 'method', callmethod: 'method',
    attr: 'attr', attribute: 'attr',
};

const TYPE_LIST = 'position|scale|rotation|alpha|color|sprite|value|visible|bool|enum'
    + '|emitter|shape|light|ui|attr|audio|method|event';

/** Вид значения типа: число, вектор/цвет, bool, строка, произвольный JSON. */
const VALUE_KIND = {
    position: 'number', scale: 'number', rotation: 'number', alpha: 'number',
    color: 'color', sprite: 'number', value: 'number',
    visible: 'bool', bool: 'bool', shape: 'bool', emitter: 'bool',
    enum: 'string', light: 'number', ui: 'raw', attr: 'raw',
};

/**
 * Встроенные binding'и: только для них тип значения известен плееру.
 * Произвольный (зарегистрированный игрой) binding получает значение ключа
 * как есть — интерпретирует его адаптер.
 */
const BUILTIN_BINDINGS = new Set([
    'transform', 'visible', 'attr', 'value', 'sprite.frame', 'sprite.clip',
    'emitter.emitting', 'emitter.position', 'shape.enabled',
    'light.intensity', 'light.radius', 'ui.style', 'ui.value', 'audio.gain',
]);

/** Binding'и, которые считаются дискретными: промежуточного значения нет. */
const DISCRETE_BINDINGS = new Set([
    'visible', 'sprite.frame', 'sprite.clip', 'emitter.emitting',
    'shape.enabled', 'enum', 'bool', 'ui.value',
]);

function isObject(value) {
    return !!value && typeof value === 'object';
}

/** Логическое значение из ключа: true/false, 0/1, 'false'/'0'/'' — ложь. */
export function boolOf(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value !== '' && value !== 'false' && value !== '0';
    return !!value;
}

/** Сравнение значений дорожки: для режима обновления 'change'. */
export function sameValue(a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    if (isObject(a) && isObject(b)) {
        try { return JSON.stringify(a) === JSON.stringify(b); }
        catch (e) { return false; }
    }
    return false;
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
// Маркеры: policy при seek/loop/skip/restore (§10, §41)
// ---------------------------------------------------------------------------

const PHASES = ['seek', 'loop', 'skip', 'restore'];

/**
 * Нормализация policy маркера/кью. Значения:
 *   seek/skip/restore — 'skip' (по умолчанию) | 'fire' | 'state';
 *   loop — 'fire' (по умолчанию) | 'once' | 'skip'.
 * 'state' — событие не проигрывается, но дискретное состояние пересчитывается
 * (это делает сам плеер при seek/skip/restore, независимо от policy).
 */
export function normalizePolicy(raw, src) {
    const o = isObject(raw) ? raw : {};
    const base = isObject(src) ? src : {};
    const read = (phase) => {
        const v = o[phase] !== undefined ? o[phase] : base[phase];
        return v === undefined || v === null ? undefined : String(v);
    };
    const out = { explicit: false };
    for (const phase of PHASES) {
        const v = read(phase);
        if (v !== undefined) out.explicit = true;
        out[phase] = v === undefined ? (phase === 'loop' ? 'fire' : 'skip') : v;
    }
    return out;
}

/**
 * Срабатывает ли маркер в фазе `phase` ('normal' | 'seek' | 'skip' | 'restore').
 *
 * В обычном ходе — всегда (ровно один раз следит вызывающий: интервал
 * полуоткрытый). При seek/skip необратимые damage/spawn маркеры молчат, пока
 * явно не попросят `{ irreversible: true }`: предпросмотр перемотки урона не
 * наносит.
 */
export function markerAllowed(ev, phase, opts) {
    if (!ev) return false;
    if (phase === undefined || phase === null || phase === 'normal') return true;
    const o = opts || {};
    if (ev.irreversible === true && o.irreversible !== true) return false;
    const policy = ev.policy || {};
    const v = policy[phase];
    if (v === 'fire') return true;
    if (v === 'skip' || v === 'state') {
        // Явная policy уважается всегда; авто-умолчание не ломает прежний
        // контракт `seek(ms, { fire: true })` — он доигрывает обычные события.
        if (policy.explicit === true) return false;
        return o.fire === true && phase !== 'restore';
    }
    return false;
}

/** Стабильный ID маркера: явный `id` или `name@at`. */
export function markerId(ev) {
    if (!ev) return null;
    if (ev.id !== undefined && ev.id !== null) return String(ev.id);
    return `${ev.name === undefined ? 'event' : ev.name}@${ev.at}`;
}

/** Уникальный ключ маркера внутри слоя: имя клипа + ID маркера. */
function markerKey(layer, ev) {
    return `${layer.timeline.name}:${markerId(ev)}`;
}

/** Повторяется ли маркер каждый проход (loop 'fire') или только один раз. */
function markerPeriodic(ev, layer) {
    if (!layer || (layer.loop !== 'loop' && layer.loop !== 'pingpong')) return false;
    if (ev.once === true) return false;
    const policy = ev.policy || {};
    return policy.loop !== 'once';
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

/** Значение ключа по виду (число, bool, строка, произвольный JSON). */
export function canonicalValue(kind, key) {
    const v = key.v;
    if (kind === 'bool') return boolOf(v === undefined && key.on !== undefined ? key.on : v);
    if (kind === 'string') return v === undefined || v === null ? '' : String(v);
    if (kind === 'raw') return v;
    return asNumber(v, 'дорожки');
}

/**
 * Канонический вид значения ключа: число, {x,y}, [r,g,b,a] или индекс кадра.
 * Для новых типов §41 вид задаётся VALUE_KIND (bool/enum/raw).
 */
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
    if (type === 'visible' || type === 'bool' || type === 'shape') return boolOf(v);
    if (type === 'enum') return v === undefined || v === null ? '' : String(v);
    if (type === 'attr' || type === 'ui' || type === 'emitter') {
        if (axis) return asNumber(v, `дорожки ${type}.${axis}`);
        return v;
    }
    return asNumber(v, `дорожки ${type}`);
}

/**
 * Ключи дорожки в каноническом виде: `t` — миллисекунды от начала клипа,
 * значения приведены к типу дорожки, ключи отсортированы по времени.
 */
export function normalizeTimelineKeys(keys, duration, type, raw) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    const axis = raw && raw.axis ? String(raw.axis) : null;
    const kind = raw && raw.kind ? String(raw.kind) : null;
    const out = keys.map((key) => {
        if (!isObject(key)) {
            throw new Error('$.anim.clip: ключ дорожки — объект { t, v, ease? } (t в миллисекундах)');
        }
        const rawT = key.t !== undefined ? key.t : (key.time !== undefined ? key.time : key.at);
        let t = Number(rawT);
        if (!isFinite(t)) t = 0;
        if (t < 0) t = 0;
        if (duration > 0 && t > duration) t = duration;
        const value = kind ? canonicalValue(kind, key) : canonicalKeyValue(type, axis, key);
        return { t, v: value, ease: key.ease };
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

/**
 * Событие клипа: `{ at, id, name, data, call, policy, window, irreversible }`,
 * `at` — миллисекунды.
 */
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
    const ev = {
        at,
        name,
        id: raw.id !== undefined ? String(raw.id) : `${name}@${at}`,
        data: raw.data,
        call,
        kind: raw.kind === undefined ? null : String(raw.kind),
        window: raw.window === undefined ? null : String(raw.window),
        windowPhase: raw.windowPhase !== undefined ? String(raw.windowPhase)
            : (raw.windowOpen === false ? 'close' : (raw.windowOpen === true ? 'open' : null)),
        once: raw.once === true,
        policy: normalizePolicy(raw.policy, raw),
    };
    ev.irreversible = raw.irreversible !== undefined ? raw.irreversible === true
        : (ev.kind === 'damage' || ev.kind === 'spawn' || ev.kind === 'kill');
    return ev;
}

/** Ключи audio-огибающей: t в мс от начала клипа, v — множитель громкости. */
function normalizeGainKeys(keys, duration, clipName) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    const out = [];
    for (const key of keys) {
        if (!isObject(key)) continue;
        const rawT = key.t !== undefined ? key.t : (key.at !== undefined ? key.at : key.time);
        let t = Number(rawT);
        if (!isFinite(t)) t = 0;
        if (t < 0) t = 0;
        if (duration > 0 && t > duration) t = duration;
        const rawV = key.v !== undefined ? key.v : (key.gain !== undefined ? key.gain : 1);
        const n = Number(rawV);
        if (!isFinite(n)) {
            ctx.log(`$.anim.clip: в audio-огибающей "${clipName}" v не число — беру 1`);
        }
        out.push({ t, v: isFinite(n) ? Math.max(0, n) : 1 });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
}

/** Общая часть нормализации cue-дорожки (audio/method): момент и policy. */
function cueAt(raw, duration) {
    const rawAt = raw.at !== undefined ? raw.at
        : (raw.t !== undefined ? raw.t : (raw.time !== undefined ? raw.time : 0));
    let at = Number(rawAt);
    if (!isFinite(at)) at = 0;
    if (at < 0) at = 0;
    if (duration > 0 && at > duration) at = duration;
    return at;
}

/** Audio cue: resource, bus, gain, offset, length, policy при seek/loop. */
export function normalizeAudioTrack(raw, duration, clipName) {
    const resource = raw.resource !== undefined ? raw.resource
        : (raw.src !== undefined ? raw.src
            : (raw.sound !== undefined ? raw.sound : raw.path));
    if (resource === undefined || resource === null || resource === '') {
        ctx.log(`$.anim.clip: audio-дорожка в "${clipName}" без resource — пропускаю`);
        return null;
    }
    const at = cueAt(raw, duration);
    const rawGain = raw.gain !== undefined ? raw.gain : (raw.volume !== undefined ? raw.volume : 1);
    const gain = Number(rawGain);
    const envSrc = raw.envelope !== undefined ? raw.envelope : raw.keys;
    return {
        type: 'audio',
        kind: 'audio',
        cue: true,
        id: raw.id !== undefined ? String(raw.id) : `audio:${resource}@${at}`,
        key: 'audio',
        storeKey: null,
        target: raw.target === undefined ? null : raw.target,
        at,
        name: raw.name === undefined ? null : String(raw.name),
        policy: normalizePolicy(raw.policy, raw),
        irreversible: raw.irreversible === true,
        once: raw.once === true,
        audio: {
            resource: String(resource),
            bus: raw.bus === undefined || raw.bus === null ? null : String(raw.bus),
            gain: isFinite(gain) ? Math.max(0, gain) : 1,
            offset: Math.max(0, Number(raw.offset) || 0),
            length: raw.length === undefined ? 0 : Math.max(0, Number(raw.length) || 0),
            loop: raw.loop === true,
            keep: raw.keep === true,
            stop: raw.stop === true,
            envelope: normalizeGainKeys(envSrc, duration, clipName),
        },
    };
}

/** Method track: имя зарегистрированного действия (без eval строки). */
export function normalizeMethodTrack(raw, duration, clipName) {
    const name = raw.name !== undefined ? raw.name
        : (raw.action !== undefined ? raw.action : raw.method);
    if (name === undefined || name === null || name === '') {
        ctx.log(`$.anim.clip: method-дорожка в "${clipName}" без name/action — пропускаю`);
        return null;
    }
    const at = cueAt(raw, duration);
    return {
        type: 'method',
        kind: 'method',
        cue: true,
        id: raw.id !== undefined ? String(raw.id) : `method:${name}@${at}`,
        key: String(name),
        storeKey: null,
        target: raw.target === undefined ? null : raw.target,
        at,
        action: String(name),
        data: raw.data,
        policy: normalizePolicy(raw.policy, raw),
        irreversible: raw.irreversible === true,
        once: raw.once === true,
    };
}

/** Какой binding соответствует типу дорожки (если binding не задан явно). */
export function bindingForTrack(type, raw) {
    switch (type) {
    case 'position': case 'scale': case 'rotation': case 'alpha': case 'color':
        return { binding: 'transform', channel: type };
    case 'sprite':
        if (raw.clip !== undefined || raw.clipName !== undefined || raw.anim !== undefined) {
            return { binding: 'sprite.clip' };
        }
        return { binding: 'sprite.frame' };
    case 'value':
        return { binding: raw.attr ? 'attr' : 'value' };
    case 'visible': return { binding: 'visible' };
    case 'bool': return { binding: raw.binding !== undefined ? String(raw.binding) : null };
    case 'enum': return { binding: raw.binding !== undefined ? String(raw.binding) : null };
    case 'emitter':
        if (raw.binding !== undefined) return { binding: String(raw.binding) };
        return { binding: raw.prop === 'position' || raw.pos === true ? 'emitter.position' : 'emitter.emitting' };
    case 'shape': return { binding: raw.binding !== undefined ? String(raw.binding) : 'shape.enabled' };
    case 'light':
        if (raw.binding !== undefined) return { binding: String(raw.binding) };
        return { binding: raw.prop === 'radius' ? 'light.radius' : 'light.intensity' };
    case 'ui':
        if (raw.binding !== undefined) return { binding: String(raw.binding) };
        return { binding: raw.field === 'value' || raw.valueSlot === true ? 'ui.value' : 'ui.style' };
    case 'attr': return { binding: 'attr' };
    default: return { binding: null };
    }
}

/**
 * Поля-параметры binding'а, общие для разрешения до play: doc/element/property
 * для RmlUi, shape index, key для attr/value.
 */
function bindingProps(raw) {
    return {
        doc: raw.doc !== undefined ? raw.doc : (raw.document !== undefined ? raw.document : raw.rml),
        element: raw.element !== undefined ? raw.element : (raw.selector !== undefined ? raw.selector : raw.el),
        property: raw.property !== undefined ? raw.property : (raw.style !== undefined ? raw.style : raw.css),
        shape: raw.shape !== undefined ? raw.shape : raw.shapeIndex,
        handle: raw.handle !== undefined ? raw.handle : null,
    };
}

/** Режим обновления: 'apply' (каждый кадр), 'change' (по изменению), 'once'. */
function updateMode(raw, binding) {
    if (raw.mode !== undefined && raw.mode !== null) {
        const m = String(raw.mode);
        if (m === 'apply' || m === 'change' || m === 'once') return m;
        if (m === 'discrete') return 'change';
        if (m === 'continuous') return 'apply';
        ctx.log(`$.anim.clip: неизвестный mode "${raw.mode}" — беру авто`);
    }
    return DISCRETE_BINDINGS.has(binding) ? 'change' : 'apply';
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
        return { type: 'event', cue: true, kind: 'event', events };
    }
    if (type === 'audio') return normalizeAudioTrack(raw, duration, clipName);
    if (type === 'method') return normalizeMethodTrack(raw, duration, clipName);

    const derived = bindingForTrack(type, raw);
    const explicit = raw.binding !== undefined && raw.binding !== null ? String(raw.binding) : null;
    const binding = explicit || derived.binding;
    const channel = derived.channel || null;
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

    let kind = null;
    if (binding && !BUILTIN_BINDINGS.has(binding)) {
        // Адаптер зарегистрирован игрой: значение ключа не переинтерпретируем.
        kind = 'raw';
    } else if (binding === 'transform' || binding === 'sprite.frame'
        || binding === 'emitter.position') {
        // Векторы position/scale/emitter и цвет считает canonicalKeyValue.
        kind = null;
    } else if (binding === 'light.intensity'
        || binding === 'light.radius' || binding === 'audio.gain') {
        kind = 'number';
    } else if (binding === 'sprite.clip' || binding === 'enum') {
        kind = 'string';
    } else if (binding === 'visible' || binding === 'emitter.emitting'
        || binding === 'shape.enabled' || binding === 'bool') {
        kind = 'bool';
    } else if (binding === 'ui.style' || binding === 'ui.value' || binding === 'attr') {
        kind = 'raw';
    } else if (binding === 'value') {
        kind = 'number';
    } else {
        kind = VALUE_KIND[type] || 'number';
    }

    const keys = normalizeTimelineKeys(raw.keys, duration, type, { axis, kind });
    const isFpsSprite = type === 'sprite' && Number(raw.fps) > 0;
    if (keys.length === 0 && !isFpsSprite) {
        ctx.log(`$.anim.clip: дорожка "${type}" в "${clipName}" без ключей — пропускаю`);
        return null;
    }

    let key;
    if (type === 'position') key = axis || 'position';
    else if (type === 'value') key = String(raw.name !== undefined ? raw.name
        : (raw.key !== undefined ? raw.key : (raw.prop !== undefined ? raw.prop : 'value')));
    else if (type === 'attr') key = String(raw.name !== undefined ? raw.name
        : (raw.key !== undefined ? raw.key : (raw.prop !== undefined ? raw.prop : 'attr')));
    else key = type;

    const target = raw.target === undefined ? null : raw.target;
    const targetLabel = target === null ? '' : `@${typeof target === 'string' ? target : String(target)}`;
    const legacy = explicit === null && target === null
        && (type === 'position' || type === 'scale' || type === 'rotation'
            || type === 'alpha' || type === 'color' || type === 'sprite'
            || (type === 'value' && !raw.attr));
    const track = {
        type,
        binding,
        channel,
        axis,
        key,
        target,
        targetLabel,
        keys,
        from: raw.from === undefined ? 0 : Math.max(0, Math.floor(Number(raw.from) || 0)),
        to: raw.to === undefined ? -1 : Math.floor(Number(raw.to)),
        fps: Number(raw.fps) > 0 ? Number(raw.fps) : 0,
        once: raw.once === true,
        // Произвольное значение по умолчанию живёт только в плеере
        // (player.value('hp')); attr: true дополнительно пишет его в node.attrs,
        // чтобы работали селекторы вида [hp<20].
        attr: raw.attr !== undefined ? !!raw.attr : isPropFallback,
        kind,
        mode: updateMode(raw, binding),
        legacy,
        name: raw.name === undefined ? null : String(raw.name),
        props: bindingProps(raw),
        initial: raw.initial !== undefined ? raw.initial : raw.reset,
        clock: raw.clock === undefined ? null : String(raw.clock),
    };
    track.sprite_frame = binding === 'sprite.frame';
    track.sprite_clip = binding === 'sprite.clip';
    track.id = raw.id !== undefined ? String(raw.id)
        : (type === 'value' || type === 'attr' ? key
            : (legacy ? (key || type) : `${binding}${channel ? '.' + channel : ''}${targetLabel}`));
    track.storeKey = (type === 'value' || type === 'attr' || legacy) ? track.key : track.id;
    return track;
}

/**
 * Проверка и нормализация объявления клипа плеера.
 * spec: { duration (мс, обязательно), loop, speed, clock, reset, tracks, events }.
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
    let clock = null;
    if (src.clock !== undefined && src.clock !== null) {
        clock = String(src.clock);
        if (CLOCKS.indexOf(clock) < 0) {
            ctx.log(`$.anim.clip: у клипа "${clipName}" неверный clock "${src.clock}" — `
                + 'допустимо simulation|presentation; беру simulation');
            clock = null;
        }
    }

    const tracks = [];
    const events = [];
    const cues = [];
    const busy = new Set();
    for (const raw of (src.tracks || [])) {
        const track = normalizeTimelineTrack(raw, duration, clipName);
        if (!track) continue;
        if (track.type === 'event') {
            for (const ev of track.events) events.push(ev);
            continue;
        }
        if (track.cue) {
            cues.push(track);
            if (busy.has(track.id)) {
                ctx.log(`$.anim.clip: в клипе "${clipName}" две дорожки с id "${track.id}" — `
                    + 'играет последняя');
            }
            busy.add(track.id);
            continue;
        }
        if (busy.has(track.id)) {
            ctx.log(`$.anim.clip: в клипе "${clipName}" две дорожки пишут в "${track.id}" — `
                + 'играет последняя');
        }
        busy.add(track.id);
        tracks.push(track);
    }
    for (const raw of (src.events || [])) {
        const ev = normalizeEvent(raw, duration);
        if (ev) events.push(ev);
    }
    events.sort((a, b) => a.at - b.at);
    cues.sort((a, b) => a.at - b.at);

    return {
        name: clipName,
        duration,
        loop,
        speed,
        clock,
        reset: src.reset === true,
        tracks,
        events,
        cues,
    };
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

/** Значение одной дорожки на момент `timeMs` (без учёта микширования). */
export function trackValueAt(track, timeMs, frameCount) {
    if (!track || track.cue) return undefined;
    // Начальная поза: пока время не ушло за первый ключ, `initial`/`reset`
    // задаёт известное значение (его же ставит player.reset()).
    if (track.initial !== undefined) {
        const first = track.keys && track.keys.length ? track.keys[0].t : 0;
        if (!(Number(timeMs) > first)) return cloneValue(track.initial);
    }
    if (track.sprite_clip) {
        return Array.isArray(track.keys) && track.keys.length ? sampleKeysAt(track.keys, timeMs) : undefined;
    }
    if (track.sprite_frame) return { frame: spriteFrameAt(track, timeMs, frameCount) };
    if (!Array.isArray(track.keys) || track.keys.length === 0) return undefined;
    return sampleKeysAt(track.keys, timeMs);
}

/**
 * Значения всех дорожек клипа на момент `timeMs`:
 * `{ position: {x,y}, alpha: 0.5, sprite: { frame: 3 }, stamina: 42, … }`.
 * Кадр спрайта отдаётся объектом `{ frame }`, а не id спрайта: id зависит от
 * узла, а индекс — от клипа. Совместимая со старым форматом функция.
 */
export function timelineValuesAt(timeline, timeMs, frameCount) {
    const values = {};
    if (!timeline) return values;
    for (const track of timeline.tracks) {
        const value = trackValueAt(track, timeMs, frameCount);
        if (value !== undefined) values[track.storeKey || track.key] = value;
    }
    return values;
}

/**
 * Значения дорожек клипа с их идентификаторами (для мультицелевого плеера):
 * массив `[{ track, id, value }]`, порядок — как в клипе.
 */
export function timelineTrackValuesAt(timeline, timeMs, frameCount) {
    const out = [];
    if (!timeline) return out;
    for (const track of timeline.tracks) {
        const value = trackValueAt(track, timeMs, frameCount);
        if (value === undefined) continue;
        out.push({ track, id: track.id, value });
    }
    return out;
}

/** Является ли дорожка дискретной (в микшировании — победитель по весу). */
export function isDiscreteTrack(track) {
    return !!(track && (track.mode === 'discrete' || DISCRETE_BINDINGS.has(track.binding)
        || track.type === 'sprite' || track.type === 'bool' || track.type === 'enum'));
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

/**
 * Микширование мультицелевых дорожек по их id.
 * `entries`: `[{ id, value, weight }]`; `discrete` — Set id дискретных дорожек.
 * Возвращает Map `id → { value, weight }`. Непрерывные значения смешиваются
 * тем же кодом, что и `blendValues`, дискретные берутся у большего веса.
 */
export function blendTrackEntries(entries, discrete) {
    const groups = new Map();
    for (const e of (entries || [])) {
        if (!e || e.value === undefined || !(e.weight > 0)) continue;
        let group = groups.get(e.id);
        if (!group) { group = []; groups.set(e.id, group); }
        group.push(e);
    }
    const out = new Map();
    for (const [id, list] of groups) {
        if (list.length === 1) {
            out.set(id, { value: cloneValue(list[0].value), weight: list[0].weight });
            continue;
        }
        const fake = list.map((e) => ({ values: { v: e.value }, weight: e.weight }));
        const merged = blendValues(fake, (discrete && discrete.has(id)) ? ['v'] : []);
        out.set(id, { value: merged.v, weight: 1 });
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
// Применение значений к узлу (легаси-путь, совместимый с прежним плеером)
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
// Реестр binding-адаптеров (§41)
//
// Свойства применяются через адаптеры существующих подсистем: произвольный
// JSON-путь не обходит physics safety — shape.enabled меняется командой
// движка, а не записью поля.
// ---------------------------------------------------------------------------

const BINDINGS = new Map();

/** Регистрация адаптера: `{ kind, resolve(root, track, player, layer), apply(handle, value, track, player, layer), initial(track) }`. */
export function registerBinding(name, adapter) {
    const key = String(name);
    if (!adapter || typeof adapter !== 'object') {
        throw new Error(`$.anim.bind: адаптер "${key}" — объект { resolve?, apply? }`);
    }
    const kind = adapter.kind === 'discrete' ? 'discrete'
        : (adapter.kind === 'cue' ? 'cue' : (adapter.kind === 'store' ? 'store' : 'continuous'));
    const entry = {
        name: key,
        kind,
        resolve: typeof adapter.resolve === 'function' ? adapter.resolve : null,
        apply: typeof adapter.apply === 'function' ? adapter.apply : null,
        initial: typeof adapter.initial === 'function' ? adapter.initial : null,
    };
    BINDINGS.set(key, entry);
    return entry;
}

/** Адаптер по имени или null. */
export function getBinding(name) {
    return BINDINGS.get(String(name)) || null;
}

/** Имена всех зарегистрированных binding'ов. */
export function bindingNames() {
    return Array.from(BINDINGS.keys());
}

/** Узловая цель адаптера или null. */
function nodeHandle(root) {
    return root ? { node: root } : null;
}

function hasMethod(obj, name) {
    return !!obj && typeof obj[name] === 'function';
}

/** Предупреждение один раз на ключ: горячий путь не должен спамить журнал. */
const warned = new Set();
function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    ctx.log(message);
}

function installBuiltinBindings() {
    if (BINDINGS.size > 0) return;

    registerBinding('transform', {
        kind: 'continuous',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value, track) => {
            if (!handle || !handle.node || handle.node.removed) return;
            writeTrackValue(handle.node, { type: track.channel, axis: track.axis }, value);
        },
    });

    registerBinding('visible', {
        kind: 'discrete',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value) => {
            if (!handle || !handle.node || handle.node.removed) return;
            handle.node.visible = boolOf(value);
        },
        initial: () => true,
    });

    registerBinding('attr', {
        kind: 'store',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value, track) => {
            if (!handle || !handle.node || handle.node.removed) return;
            if (handle.node.attrs) handle.node.attrs[track.key] = value;
        },
    });

    registerBinding('value', {
        kind: 'store',
        resolve: () => ({ store: true }),
        apply: () => {},
    });

    registerBinding('sprite.frame', {
        kind: 'discrete',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value, track) => {
            if (!handle || !handle.node || handle.node.removed) return;
            const frames = handle.node.frames;
            if (!frames || frames.length === 0) return;
            const rawFrame = isObject(value) ? value.frame : value;
            const index = Math.max(0, Math.min(frames.length - 1, Math.round(Number(rawFrame) || 0)));
            handle.node.sprite = frames[index];
            handle.node.frame_index = index;
        },
    });

    registerBinding('sprite.clip', {
        kind: 'discrete',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value, track) => {
            if (!handle || !handle.node || handle.node.removed) return;
            const name = value === undefined || value === null ? '' : String(value);
            const wrapped = wrapOne(handle.node);
            if (hasMethod(wrapped, 'playClip')) {
                wrapped.playClip(name, { restart: track.once === true });
                return;
            }
            warnOnce('sprite.clip', '$.anim: binding "sprite.clip" требует anim.js (.playClip) — '
                + 'имя клипа пропущено');
        },
    });

    registerBinding('emitter.emitting', {
        kind: 'discrete',
        resolve: (root) => {
            if (!root) return null;
            const wrapped = wrapOne(root);
            return hasMethod(wrapped, 'emitting') ? { node: root, wrapper: wrapped } : null;
        },
        apply: (handle, value) => {
            if (!handle || !handle.node || handle.node.removed) return;
            if (hasMethod(handle.wrapper, 'emitting')) handle.wrapper.emitting(boolOf(value));
        },
        initial: () => true,
    });

    registerBinding('emitter.position', {
        kind: 'continuous',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value, track) => {
            if (!handle || !handle.node || handle.node.removed) return;
            if (track.axis === 'x') { handle.node.x = value; return; }
            if (track.axis === 'y') { handle.node.y = value; return; }
            if (isObject(value)) { handle.node.x = value.x; handle.node.y = value.y; }
        },
    });

    registerBinding('shape.enabled', {
        kind: 'discrete',
        resolve: (root) => {
            if (!root || root.removed) return null;
            if (root.body === undefined || root.body === null || root.body < 0) return null;
            return { node: root, body: root.body };
        },
        apply: (handle, value, track) => {
            if (!handle || !handle.node || handle.node.removed) return;
            const flag = boolOf(value);
            // Безопасная команда движка; при наличии per-shape гейта (§40)
            // используется он, иначе — тело целиком и только для одной формы.
            if (engine && typeof engine.setShapeEnabled === 'function') {
                try { engine.setShapeEnabled(handle.body, track.props.shape === undefined ? 0 : track.props.shape, flag); }
                catch (e) { warnOnce('shape.enabled', `$.anim: shape.enabled не сработал: ${e}`); }
                return;
            }
            if (track.props.shape !== undefined) {
                warnOnce('shape.enabled:index', '$.anim: в этой сборке нет engine.setShapeEnabled — '
                    + 'per-shape enable недоступен (обновите движок, §40); дорожка пропущена');
                return;
            }
            if (engine && typeof engine.setBodyEnabled === 'function') {
                try { engine.setBodyEnabled(handle.body, flag); }
                catch (e) { warnOnce('shape.enabled:body', `$.anim: shape.enabled не сработал: ${e}`); }
                return;
            }
            warnOnce('shape.enabled:missing', '$.anim: в этой сборке нет ни engine.setShapeEnabled, '
                + 'ни engine.setBodyEnabled — дорожка shape.enabled молчит');
        },
        initial: () => true,
    });

    registerBinding('light.intensity', {
        kind: 'continuous',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value) => {
            if (!handle || !handle.node || handle.node.removed) return;
            handle.node.intensity = Number(value);
        },
    });

    registerBinding('light.radius', {
        kind: 'continuous',
        resolve: (root) => nodeHandle(root),
        apply: (handle, value) => {
            if (!handle || !handle.node || handle.node.removed) return;
            handle.node.radius = Number(value);
        },
    });

    registerBinding('ui.style', {
        kind: 'continuous',
        resolve: (root, track) => {
            const ui = ctx.ui;
            if (!ui || typeof ui.doc !== 'function') return null;
            const docPath = track.props.doc;
            const element = track.props.element;
            if (!docPath || !element) return null;
            const doc = ui.doc(String(docPath));
            if (!doc || typeof doc.style !== 'function') return null;
            return { doc, element: String(element), property: String(track.props.property || 'opacity') };
        },
        apply: (handle, value) => {
            if (!handle) return;
            try { handle.doc.style(handle.element, handle.property, value); }
            catch (e) { warnOnce('ui.style', `$.anim: ui.style не сработал: ${e}`); }
        },
    });

    registerBinding('ui.value', {
        kind: 'discrete',
        resolve: (root, track) => {
            const ui = ctx.ui;
            if (!ui || typeof ui.doc !== 'function') return null;
            const docPath = track.props.doc;
            const element = track.props.element;
            if (!docPath || !element) return null;
            const doc = ui.doc(String(docPath));
            if (!doc || typeof doc.setValue !== 'function') return null;
            return { doc, element: String(element) };
        },
        apply: (handle, value) => {
            if (!handle) return;
            try { handle.doc.setValue(handle.element, value); }
            catch (e) { warnOnce('ui.value', `$.anim: ui.value не сработал: ${e}`); }
        },
    });

    registerBinding('audio.gain', {
        kind: 'continuous',
        resolve: (root, track, player) => {
            if (!player) return null;
            const key = track.props.handle !== undefined && track.props.handle !== null
                ? String(track.props.handle) : String(track.key || track.id);
            return { player, key };
        },
        apply: (handle, value) => {
            if (!handle || !handle.player) return;
            const sound = handle.player.audio_handles.get(handle.key);
            if (!sound) return;
            setHandleVolume(sound, Number(value));
        },
    });
}

installBuiltinBindings();

// ---------------------------------------------------------------------------
// Реестр действий для method-дорожек (§41): без eval строки
// ---------------------------------------------------------------------------

const actions = new Map();
const actionWarned = new Set();

/** Зарегистрировать действие: method-дорожка зовёт его по имени. */
export function registerAction(name, fn) {
    const key = String(name);
    if (typeof fn !== 'function') {
        ctx.log(`$.anim.action: "${key}" — нужна функция (получено ${typeof fn})`);
        return null;
    }
    actions.set(key, fn);
    actionWarned.delete(key);
    return fn;
}

export function getAction(name) {
    return actions.get(String(name)) || null;
}

export function actionNames() {
    return Array.from(actions.keys());
}

function installBuiltinActions() {
    if (actions.size > 0) return;
    registerAction('camera.shake', (p) => {
        const cam = ctx.camera;
        const data = (p && p.data) || {};
        if (cam && typeof cam.shake === 'function') {
            cam.shake(Number(data.intensity === undefined ? 4 : data.intensity),
                Number(data.ms === undefined ? 200 : data.ms));
        }
    });
    registerAction('camera.zoom', (p) => {
        const cam = ctx.camera;
        const data = (p && p.data) || {};
        if (cam && typeof cam.zoom === 'function') cam.zoom(Number(data.zoom === undefined ? 1 : data.zoom));
    });
    registerAction('camera.pan', (p) => {
        const cam = ctx.camera;
        const data = (p && p.data) || {};
        if (cam && typeof cam.panTo === 'function') {
            cam.panTo(Number(data.x) || 0, Number(data.y) || 0, Number(data.ms === undefined ? 0 : data.ms));
        }
    });
    registerAction('sound.stop', (p) => {
        const data = (p && p.data) || {};
        if (ctx.sound && typeof ctx.sound.stopAll === 'function') ctx.sound.stopAll(Number(data.fade) || 0);
    });
}

installBuiltinActions();

// ---------------------------------------------------------------------------
// Целевые пути (§41): target относительно корня плеера, стабильный ID/path
// ---------------------------------------------------------------------------

/** Имя дочернего узла пути: id или attrs.name. Только прямые дети: путь стабилен. */
function childByName(node, name) {
    const list = node && node.child_nodes ? node.child_nodes : [];
    for (let i = 0; i < list.length; i++) {
        const child = list[i];
        if (child.id === name) return child;
        if (child.attrs && child.attrs.name === name) return child;
    }
    return null;
}

/**
 * Разрешение target'а дорожки до play (не селектором на каждом кадре).
 *
 *   null/''/'.'/'self'   — корень плеера;
 *   '#id', '.cls', 'tag' — селектор (один раз, до play);
 *   'weapon/barrel'      — путь по прямым детям (id или attrs.name);
 *   узел/обёртка/массив  — как есть.
 *
 * Возвращает `{ node, id, path }`: `id` — стабильный идентификатор цели
 * (`#id`, иначе сам путь), `node` — null, если цель не найдена.
 */
export function resolveTrackTarget(root, spec) {
    if (spec === undefined || spec === null || spec === '') {
        return { node: root || null, id: root && root.id ? `#${root.id}` : '.', path: '.' };
    }
    if (typeof spec !== 'string') {
        const node = resolveTarget(spec);
        return {
            node,
            id: node && node.id ? `#${node.id}` : String(spec),
            path: String(spec),
        };
    }
    const s = spec.trim();
    if (s === '' || s === '.' || s === 'self' || s === '$' || s === 'root') {
        return { node: root || null, id: root && root.id ? `#${root.id}` : '.', path: '.' };
    }
    if (s[0] === '#' || s[0] === '.' || s[0] === '[' || s.indexOf(' ') >= 0 || s.indexOf('>') >= 0) {
        const found = query(s);
        const node = found.length ? found[0] : null;
        return { node, id: node && node.id ? `#${node.id}` : s, path: s };
    }
    if (!root) return { node: null, id: s, path: s };
    let cur = root;
    const parts = s.split('/').filter(Boolean);
    for (const part of parts) {
        const next = childByName(cur, part);
        if (!next) return { node: null, id: s, path: s };
        cur = next;
    }
    return { node: cur, id: cur.id ? `#${cur.id}` : s, path: s };
}

// ---------------------------------------------------------------------------
// Плеер
// ---------------------------------------------------------------------------

const timelines = new Map();      // имя → нормализованный клип плеера
const players = [];               // все созданные плееры, в порядке создания
const tick_list = [];             // снимок на кадр (обработчики могут менять список)
let default_player = null;

/** Событие плеера: и общее 'event', и под своим именем, и прямой вызов call. */
function emitPlayerEvent(player, layer, ev, phase) {
    const payload = markerPayload(player, layer, ev, phase);
    dispatch(player, 'event', payload);
    if (ev.name && ev.name !== 'event') dispatch(player, ev.name, payload);
    if (typeof ev.call === 'function') {
        try { ev.call(payload); }
        catch (e) {
            ctx.log(`$.anim: ошибка в вызове события "${ev.name}" клипа `
                + `"${layer.timeline.name}": ${e}`);
        }
    }
    applyWindowMarker(player, layer, ev, payload);
    // Маркер дублируется событием узла-корня: игровой код слушает и узел.
    if (player.node && typeof player.node.emit === 'function') {
        try { player.node.emit(ev.name || 'event', payload); }
        catch (e) { /* узел мог быть удалён из мира */ }
    }
}

function markerPayload(player, layer, ev, phase) {
    return {
        name: ev.name,
        id: markerId(ev),
        data: ev.data === undefined ? {} : ev.data,
        at: ev.at,
        clip: layer.timeline,
        clipName: layer.timeline.name,
        player,
        phase: phase === undefined ? 'normal' : phase,
        policy: ev.policy,
        irreversible: ev.irreversible === true,
    };
}

function dispatch(player, name, payload) {
    const list = player.listeners.get(name);
    if (!list || list.length === 0) return;
    for (const fn of list.slice()) {
        try { fn(payload); }
        catch (e) { ctx.log(`$.anim: ошибка в обработчике "${name}" плеера "${player.name}": ${e}`); }
    }
}

/** Gameplay-окно (§10): маркер открывает/закрывает окно по имени. */
function applyWindowMarker(player, layer, ev, payload) {
    if (!ev || !ev.window) return;
    const name = String(ev.window);
    const open = ev.windowPhase === undefined || ev.windowPhase === null
        ? ev.windowOpen !== false : ev.windowPhase !== 'close';
    const entry = { name, open, at: ev.at, clip: layer.timeline.name, layer };
    player.window_state.set(name, entry);
    payload.window = { name, open };
    dispatch(player, 'window', payload);
}

/** Закрыть окна слоя (прерывание, конец клипа, остановка). */
function closeLayerWindows(player, layer, reason) {
    for (const [name, entry] of player.window_state) {
        if (entry.layer !== layer || entry.open === false) continue;
        const closed = Object.assign({}, entry, { open: false, reason });
        player.window_state.set(name, closed);
        dispatch(player, 'window', {
            name, id: markerId(entry), data: {}, at: entry.at,
            clip: layer.timeline, clipName: layer.timeline.name, player,
            phase: reason, window: { name, open: false, reason },
        });
    }
}

// --- звук: handle-ы живут в слое и не трогают чужие каналы -----------------

function setHandleVolume(handle, value) {
    if (!handle) return;
    const v = Math.max(0, Number(value) || 0);
    if (typeof handle.volume === 'function') { handle.volume(v); return; }
    if (handle.channel >= 0 && engine && engine.audio
        && typeof engine.audio.setChannelVolume === 'function') {
        try { engine.audio.setChannelVolume(handle.channel, v); } catch (e) { /* канал свободен */ }
    }
}

function seekHandle(handle, seconds) {
    if (!handle) return;
    if (typeof handle.seek === 'function') { handle.seek(seconds); return; }
    if (handle.channel >= 0 && ctx.sound && typeof ctx.sound.seek === 'function') {
        ctx.sound.seek(handle.channel, seconds);
    }
}

/** Запасной handle для сборки без $.audio (шины): канал + своя громкость. */
function fallbackHandle(channel) {
    let base = 1;
    return {
        channel,
        volume(value) {
            if (value === undefined) return base;
            base = Math.max(0, Number(value) || 0);
            if (engine && engine.audio && typeof engine.audio.setChannelVolume === 'function') {
                try { engine.audio.setChannelVolume(channel, base); } catch (e) { /* канал свободен */ }
            }
            return null;
        },
        stop(fadeMs) {
            if (ctx.sound && typeof ctx.sound.stop === 'function') ctx.sound.stop(channel, fadeMs || 0);
            else if (engine && engine.audio && typeof engine.audio.stop === 'function') {
                try { engine.audio.stop(channel, fadeMs || 0); } catch (e) { /* уже остановлен */ }
            }
            return null;
        },
        playing() {
            if (ctx.sound && typeof ctx.sound.playing === 'function') return !!ctx.sound.playing(channel);
            return true;
        },
    };
}

/** Audio cue: resource, bus, gain, offset, length; handle принадлежит дорожке. */
function playAudioCue(player, layer, track, phase) {
    const a = track.audio;
    let inst = layer.audio.get(track.id);
    if (!inst) { inst = { handle: null, started: -1, baseGain: a.gain }; layer.audio.set(track.id, inst); }
    if (a.stop) {
        // Stop-cue: гасит звуки этого слоя, не трогая чужие.
        for (const other of layer.audio.values()) stopAudioInstance(other);
        return;
    }
    if (inst.handle) stopAudioInstance(inst);
    let handle = null;
    if (ctx.audio && typeof ctx.audio.play === 'function') {
        const opts = { volume: a.gain, loop: a.loop };
        if (a.bus) opts.bus = a.bus;
        try { handle = ctx.audio.play(a.resource, opts); }
        catch (e) { handle = null; warnOnce('audio:play', `$.anim: audio "${a.resource}" не запустился: ${e}`); }
    } else if (ctx.sound && typeof ctx.sound.play === 'function') {
        let channel = -1;
        try { channel = ctx.sound.play(a.resource, { volume: a.gain, loop: a.loop }); }
        catch (e) { channel = -1; }
        if (channel >= 0) handle = fallbackHandle(channel);
    } else {
        warnOnce('audio:missing', '$.anim: audio-дорожка без $.sound/$.audio — звук пропущен');
    }
    if (!handle) return;
    inst.handle = handle;
    inst.started = player.clock_ms;
    inst.baseGain = a.gain;
    if (a.offset > 0) seekHandle(handle, a.offset);
    player.audio_handles.set(`audio:${track.id}`, handle);
}

function stopAudioInstance(inst) {
    if (!inst || !inst.handle) return;
    try { if (typeof inst.handle.stop === 'function') inst.handle.stop(0); }
    catch (e) { /* звук мог уже кончиться */ }
    inst.handle = null;
}

/** Остановить все audio cue слоя (конец клипа, stop, прерывание). */
function stopLayerAudio(player, layer, force) {
    for (const [id, inst] of layer.audio) {
        const track = layer.audioTracks.get(id);
        if (!force && track && track.audio.keep) continue;
        stopAudioInstance(inst);
        if (inst.handle === null) player.audio_handles.delete(`audio:${id}`);
    }
    return layer;
}

// --- method-дорожки ---------------------------------------------------------

function emitMethodCue(player, layer, cue, phase) {
    const payload = markerPayload(player, layer, cue, phase);
    dispatch(player, 'event', payload);
    dispatch(player, cue.action, payload);
    const fn = layer.actions.get(cue.id);
    if (typeof fn === 'function') {
        try { fn(payload); }
        catch (e) {
            ctx.log(`$.anim: ошибка в действии "${cue.action}" клипа "${layer.timeline.name}": ${e}`);
        }
    } else if (!actionWarned.has(cue.action)) {
        actionWarned.add(cue.action);
        ctx.log(`$.anim: действие "${cue.action}" не зарегистрировано — `
            + 'объявите его через $.anim.action(name, fn)');
    }
    // Method-дорожка — это и есть «вызвать действие или emit»: узел-корень
    // получает событие под именем действия, игровой код может слушать узел.
    if (player.node && typeof player.node.emit === 'function') {
        try { player.node.emit(cue.action, payload); }
        catch (e) { /* узел мог быть удалён из мира */ }
    }
    applyWindowMarker(player, layer, cue, payload);
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
        this.clock_ms = 0;             // часы плеера, мс; идут только вперёд
        this.speedValue = 1;
        this.loopValue = null;         // null — «как в клипе»
        this.pausedFlag = false;
        this.values_store = {};
        this.listeners = new Map();
        this.destroyed = false;
        // §41/§10
        this.clockValue = 'simulation';    // домен часов (§6)
        this.clockExplicit = false;
        this.window_state = new Map();    // имя окна → { name, open, at, clip, layer }
        this.audio_handles = new Map();    // имя → handle звука (для audio.gain)
        this.fired_markers = new Set();    // маркеры с policy loop 'once'
    }

    // --- цель --------------------------------------------------------------

    /** Узел-цель (корень для target'ов дорожек): узел, обёртка, селектор, '#id'. */
    target(value) {
        if (value === undefined) return this.node;
        this.node = resolveTarget(value);
        if (!this.node && value !== null) {
            ctx.log(`$.anim: цель анимации "${value}" не найдена — проверьте id/селектор узла`);
        }
        // Binding'и разрешены до play и привязаны к узлам: после смены корня
        // их надо пересобрать, иначе дорожки писали бы в старые цели.
        for (const layer of this.slots.values()) this.bindLayer(layer);
        return this;
    }

    // --- домен часов (§6) ---------------------------------------------------

    /**
     * Домен часов: 'simulation' (по умолчанию) или 'presentation'.
     * simulation тикает `$.time.delta()` — пауза и hit-stop его останавливают;
     * presentation тикает сырым временем кадра и продолжается на паузе
     * (политика VFX/камеры). Без аргумента — геттер.
     */
    clock(value) {
        if (value === undefined) return this.clockValue;
        const v = String(value);
        if (CLOCKS.indexOf(v) < 0) {
            ctx.log(`$.anim.clock: неверный домен "${value}" — допустимо simulation|presentation`);
            return this;
        }
        this.clockValue = v;
        this.clockExplicit = true;
        return this;
    }

    // --- воспроизведение ----------------------------------------------------

    /**
     * Играть клип. opts: { slot, weight, loop, speed, restart, time, offset,
     * onEnd, reset, clock }.
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
        if (o.clock !== undefined) this.clock(o.clock);
        else if (timeline.clock && !this.clockExplicit) this.clockValue = timeline.clock;

        const slot = o.slot === undefined ? 'base' : String(o.slot);
        if (slot === 'base') {
            const current = this.slots.get('base');
            if (o.restart !== true && current && current.timeline === timeline) return this;
            this.stopLayers('interrupt');
            this.clock_ms = o.time !== undefined ? Math.max(0, Number(o.time) || 0) : 0;
            this.pausedFlag = false;
        } else if (o.restart === true) {
            this.clock_ms = o.time !== undefined ? Math.max(0, Number(o.time) || 0) : 0;
        } else if (o.time !== undefined) {
            this.clock_ms = Math.max(0, Number(o.time) || 0);
        }
        const layer = this.addLayer(name, slot, o);
        if (!layer) return this;
        // reset: начальная поза — часы в 0, дискретное состояние пересчитано.
        if (o.reset === true || timeline.reset === true) {
            this.clock_ms = 0;
            this.markDirty();
        }
        if (slot === 'base' && this.clock_ms === 0) {
            // Событие at: 0 срабатывает сразу, не дожидаясь кадра: иначе
            // «стартовое» событие можно было бы пропустить, остановив плеер в
            // том же кадре. Старт с середины (opts.time) прошлые события не
            // доигрывает: это прыжок, а не проигрывание пропущенного.
            this.fireRange(layer, -1, 0, 'normal', null);
        }
        this.applyValues(true);
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
            instances: [],
            audio: new Map(),
            audioTracks: new Map(),
            actions: new Map(),
            fired_ever: new Set(),
        };
        this.slots.set(slot, layer);
        this.bindLayer(layer);
        return layer;
    }

    /**
     * Разрешение target'ов и binding'ов слоя ДО воспроизведения: в кадре нет
     * ни селекторов, ни поиска по сцене — только вызовы адаптеров.
     */
    bindLayer(layer) {
        if (!layer) return layer;
        if (layer.audio.size > 0) stopLayerAudio(this, layer, true);
        layer.instances.length = 0;
        layer.audio.clear();
        layer.audioTracks.clear();
        layer.actions.clear();
        const root = this.node;
        for (const track of layer.timeline.tracks) {
            const adapter = BINDINGS.get(track.binding);
            if (!adapter) {
                ctx.log(`$.anim.play: неизвестный binding "${track.binding}" у дорожки `
                    + `"${track.id}" клипа "${layer.timeline.name}" — пропускаю`);
                continue;
            }
            const resolved = resolveTrackTarget(root, track.target);
            if (!resolved.node && adapter.kind !== 'store') {
                ctx.log(`$.anim.play: цель "${track.target}" дорожки "${track.id}" клипа `
                    + `"${layer.timeline.name}" не найдена — пропускаю`);
                continue;
            }
            const handle = adapter.resolve ? adapter.resolve(resolved.node, track, this, layer) : null;
            if (!handle && adapter.kind !== 'store') {
                ctx.log(`$.anim.play: binding "${track.binding}" дорожки "${track.id}" не разрешился `
                    + `(нет цели/подсистемы) — пропускаю`);
                continue;
            }
            layer.instances.push({
                track,
                adapter,
                handle,
                target: resolved.node,
                targetId: resolved.id,
                mode: track.mode,
                last: undefined,
                applied: false,
            });
        }
        for (const cue of layer.timeline.cues) {
            if (cue.kind === 'audio') {
                layer.audioTracks.set(cue.id, cue);
                layer.audio.set(cue.id, { handle: null, started: -1, baseGain: cue.audio.gain });
                continue;
            }
            if (cue.kind === 'method') {
                const fn = actions.get(cue.action);
                if (typeof fn === 'function') layer.actions.set(cue.id, fn);
                else if (!actionWarned.has(cue.action)) {
                    actionWarned.add(cue.action);
                    ctx.log(`$.anim.play: действие "${cue.action}" не зарегистрировано — `
                        + 'дорожка будет молчать (объявите $.anim.action)');
                }
            }
        }
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
        this.stopLayers('interrupt');
        this.clock_ms = o.time !== undefined ? Math.max(0, Number(o.time) || 0) : 0;
        this.pausedFlag = false;
        const optsA = Object.assign({}, o, { weight: 1 - k });
        const optsB = Object.assign({}, o, { weight: k });
        const layerA = this.addLayer(a, 'blend-a', optsA);
        const layerB = this.addLayer(b, 'blend-b', optsB);
        if (layerA && k < 1 && this.clock_ms === 0) this.fireRange(layerA, -1, 0, 'normal', null);
        if (layerB && k > 0 && this.clock_ms === 0) this.fireRange(layerB, -1, 0, 'normal', null);
        this.applyValues(true);
        return this;
    }

    /** Пауза/продолжение часов. */
    pause() { this.pausedFlag = true; return this; }
    resume() { this.pausedFlag = false; return this; }
    paused() { return this.pausedFlag; }

    /**
     * Остановка: без аргумента — всё и сброс часов, с именем клипа — только
     * этот клип. После остановки события клипа больше не приходят, значения
     * остаются в последнем состоянии (плеер не «телепортирует» узел назад);
     * audio cue слоя гасятся, gameplay-окна закрываются (reason 'interrupt').
     */
    stop(clipName) {
        if (clipName === undefined) {
            this.stopLayers('interrupt');
            this.clock_ms = 0;
            this.pausedFlag = false;
            this.values_store = {};
            return this;
        }
        const name = String(clipName);
        for (const [slot, layer] of Array.from(this.slots.entries())) {
            if (layer.timeline.name === name) this.removeLayer(slot, layer, 'interrupt');
        }
        return this;
    }

    /** Прерывание (атака отменена): закрывает окна и гасит cue этого клипа. */
    interrupt(clipName) {
        return this.stop(clipName);
    }

    /** Внутреннее: снять все слои (с закрытием окон и остановкой звука). */
    stopLayers(reason) {
        for (const [slot, layer] of Array.from(this.slots.entries())) {
            this.removeLayer(slot, layer, reason);
        }
        return this;
    }

    removeLayer(slot, layer, reason) {
        if (this.slots.get(slot) === layer) this.slots.delete(slot);
        closeLayerWindows(this, layer, reason);
        stopLayerAudio(this, layer, false);
        return this;
    }

    /**
     * Перемотка на `ms` от начала клипа.
     *
     * По умолчанию перемотка события НЕ вызывает: это прыжок, а не
     * проигрывание пропущенного куска. Нужны события — `{ fire: true }`.
     * Дискретное состояние (visible/bool/enum/кадр/формы/эмиттер) после
     * перемотки пересчитывается всегда, а необратимые damage/spawn маркеры
     * молчат, пока явно не попросят `{ irreversible: true }` (предпросмотр
     * урона не наносит).
     */
    seek(ms, opts) {
        return this.jump(ms, 'seek', opts);
    }

    /** Пропуск вперёд: как seek, но policy-фаза 'skip' (для skip-логики flow). */
    skip(ms, opts) {
        return this.jump(ms, 'skip', opts);
    }

    /** Восстановление позиции (save/load, replay): policy-фаза 'restore'. */
    restore(ms, opts) {
        return this.jump(ms, 'restore', opts);
    }

    jump(ms, phase, opts) {
        const to = Math.max(0, Number(ms) || 0);
        const from = this.clock_ms;
        this.clock_ms = to;
        const o = opts || {};
        for (const layer of this.slots.values()) {
            // Дискретное состояние пересчитывается принудительно (mode 'change'/
            // 'once' иначе оставили бы значение прошлой позиции).
            for (const inst of layer.instances) { inst.last = undefined; inst.applied = false; }
            if (o.fire === true && to > from) this.fireRange(layer, from, to, phase, o);
        }
        this.applyValues(true);
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
    total() { return this.clock_ms; }

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

    // --- §41: сброс, окна, звук, разрешённые привязки ------------------------

    /**
     * Начальная поза известных значений: часы в 0, значения дорожек — их
     * `initial`/`reset` (если задан) или первый ключ. Слои не снимаются:
     * после reset клип играет с начала.
     */
    reset() {
        this.clock_ms = 0;
        this.markDirty();
        this.applyValues(true);
        return this;
    }

    /** Снять кэш записанных значений: дискретное состояние пересчитается. */
    markDirty() {
        for (const layer of this.slots.values()) {
            for (const inst of layer.instances) { inst.last = undefined; inst.applied = false; }
        }
        return this;
    }

    /** Состояние gameplay-окна: `true`, если окно открыто. */
    window(name) {
        const entry = this.window_state.get(String(name));
        return !!(entry && entry.open);
    }

    /** Все известные окна: `[{ name, open, at, clip }]`. */
    windows() { return Array.from(this.window_state.values()); }

    /** Список открытых окон. */
    openWindows() {
        return Array.from(this.window_state.values()).filter((w) => w.open).map((w) => w.name);
    }

    /** Разрешённые binding'и играющих слоёв (для отладки и тестов). */
    bindings() {
        const out = [];
        for (const layer of this.slots.values()) {
            for (const inst of layer.instances) {
                out.push({
                    clip: layer.timeline.name,
                    id: inst.track.id,
                    binding: inst.track.binding,
                    target: inst.targetId,
                    mode: inst.mode,
                    resolved: !!inst.handle,
                });
            }
        }
        return out;
    }

    /** Сработал ли маркер (policy loop 'once') в этом плеере. */
    markerFired(id) { return this.fired_markers.has(String(id)); }

    /** Зарегистрировать внешний handle звука для binding'а audio.gain. */
    audioHandle(name, handle) {
        const key = String(name);
        if (handle === undefined) return this.audio_handles.get(key) || null;
        if (handle === null) { this.audio_handles.delete(key); return this; }
        this.audio_handles.set(key, handle);
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
        this.stopLayers('destroy');
        this.listeners.clear();
        this.values_store = {};
        this.window_state.clear();
        this.audio_handles.clear();
        this.fired_markers.clear();
        this.clock_ms = 0;
        this.node = null;
        this.destroyed = true;
        return this;
    }

    // --- внутреннее ---------------------------------------------------------

    /** Основной слой: базовый слот, иначе первый по порядку добавления. */
    primary() {
        return this.slots.get('base') || this.slots.values().next().value || null;
    }

    /**
     * Маркер с `policy.loop: 'once'` (или `once: true`) срабатывает один раз за
     * всё время жизни слоя — в том числе если перемотали назад. Обычный маркер
     * после перемотки срабатывает снова при новом пересечении: rewind — это
     * осознанный повтор прохода, а не дубль.
     */
    markerOnce(ev, layer) {
        if (!ev) return false;
        const onceEver = ev.once === true || (ev.policy && ev.policy.loop === 'once');
        if (!onceEver) return false;
        const key = markerKey(layer, ev);
        if (layer.fired_ever.has(key)) return true;
        layer.fired_ever.add(key);
        this.fired_markers.add(key);
        return false;
    }

    /**
     * Маркеры и cue слоя, попавшие в интервал часов плеера (со своим темпом
     * слоя), с фильтром policy. phase: 'normal' | 'seek' | 'skip' | 'restore'.
     */
    fireRange(layer, fromMs, toMs, phase, opts) {
        if (!layer || !(layer.weight > 0)) return;
        const k = layer.speed;
        if (!(k > 0)) return;
        const from = (fromMs - layer.offset) * k;
        const to = (toMs - layer.offset) * k;
        if (!(to > from)) return;
        const ph = phase === undefined || phase === null ? 'normal' : phase;

        const list = eventsBetweenTimes(layer.timeline.events, from, to, layer.timeline.duration, layer.loop);
        for (const ev of list) {
            if (!markerAllowed(ev, ph, opts)) continue;
            if (this.markerOnce(ev, layer)) continue;
            emitPlayerEvent(this, layer, ev, ph);
        }

        for (const cue of layer.timeline.cues) {
            if (!markerAllowed(cue, ph, opts)) continue;
            const loop = markerPeriodic(cue, layer) ? layer.loop : 'once';
            const moments = eventsBetweenTimes([cue], from, to, layer.timeline.duration, loop);
            if (moments.length === 0) continue;
            if (this.markerOnce(cue, layer)) continue;
            if (cue.kind === 'audio') playAudioCue(this, layer, cue, ph);
            else emitMethodCue(this, layer, cue, ph);
        }
    }

    /** Пересчитать значения всех слоёв, смешать и записать через адаптеры. */
    applyValues(force) {
        const frameCount = this.node && this.node.frames ? this.node.frames.length : 0;
        const layers = [];
        for (const layer of this.slots.values()) if (layer.weight > 0) layers.push(layer);
        const entries = [];
        const tracksById = new Map();
        for (const layer of layers) {
            const state = playheadState(layerTime(this, layer), layer.timeline.duration, layer.loop);
            for (const inst of layer.instances) {
                const value = trackValueAt(inst.track, state.position, frameCount);
                if (value === undefined) continue;
                if (!tracksById.has(inst.track.id)) tracksById.set(inst.track.id, inst.track);
                entries.push({ id: inst.track.id, value, weight: layer.weight });
            }
        }
        const discrete = new Set();
        for (const [id, track] of tracksById) if (isDiscreteTrack(track)) discrete.add(id);
        const merged = blendTrackEntries(entries, discrete);

        const store = {};
        for (const [id, entry] of merged) {
            const track = tracksById.get(id);
            store[track.storeKey || id] = cloneValue(entry.value);
        }
        this.values_store = store;

        for (const layer of layers) {
            for (const inst of layer.instances) {
                const entry = merged.get(inst.track.id);
                if (!entry) continue;
                this.applyInstance(layer, inst, entry.value, force === true);
            }
            this.stepAudio(layer);
        }
        return store;
    }

    /** Запись одного значения с учётом режима обновления. */
    applyInstance(layer, inst, value, force) {
        if (inst.mode === 'once' && inst.applied && !force) return;
        if (!force && inst.mode === 'change' && sameValue(inst.last, value)) return;
        inst.applied = true;
        inst.last = cloneValue(value);
        if (!inst.adapter || typeof inst.adapter.apply !== 'function') return;
        inst.adapter.apply(inst.handle, value, inst.track, this, layer);
    }

    /** Громкость cue привязана к СВОЕМУ handle: чужие звуки не затрагиваются. */
    stepAudio(layer) {
        if (layer.audio.size === 0) return;
        const state = playheadState(layerTime(this, layer), layer.timeline.duration, layer.loop);
        for (const [id, inst] of layer.audio) {
            if (!inst.handle) continue;
            const track = layer.audioTracks.get(id);
            if (!track) continue;
            const env = track.audio.envelope;
            let gain = inst.baseGain;
            if (env && env.length > 0) gain *= sampleKeysAt(env, state.position);
            setHandleVolume(inst.handle, gain);
            const length = track.audio.length;
            if (length > 0 && inst.started >= 0 && (this.clock_ms - inst.started) >= length) {
                stopAudioInstance(inst);
                this.audio_handles.delete(`audio:${id}`);
            }
        }
    }
}

/** Начальное значение дорожки: `initial`/`reset`, иначе первый ключ. */
export function initialTrackValue(track) {
    if (!track || track.cue) return undefined;
    if (track.initial !== undefined) return cloneValue(track.initial);
    if (track.sprite_frame) return { frame: track.from > 0 ? track.from : 0 };
    if (track.keys && track.keys.length > 0) return cloneValue(track.keys[0].v);
    return undefined;
}

/** Локальное время слоя: часы плеера со сдвигом слота и темпом клипа. */
function layerTime(player, layer) {
    return (player.clock_ms - layer.offset) * layer.speed;
}

/** Сырое время кадра в мс (для домена 'presentation'); -1 — недоступно. */
function rawFrameMs() {
    const t = ctx.time;
    if (t && typeof t.rawDelta === 'function') {
        const d = Number(t.rawDelta());
        if (isFinite(d) && d >= 0) return d * 1000;
    }
    return -1;
}

/** Шаг часов плеера: simulation — переданный dt, presentation — сырой кадр. */
export function playerStepMs(player, dtMs) {
    if (player && player.clockValue === 'presentation') {
        const raw = rawFrameMs();
        if (raw >= 0) return raw;
    }
    return dtMs;
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

/** Завершение слоя: окна закрываются, звук гаснет (если не keep). */
function finishLayer(player, layer, reason) {
    closeLayerWindows(player, layer, reason);
    stopLayerAudio(player, layer, false);
}

/**
 * Продвинуть один плеер на `dtMs` миллисекунд: события, значения, концы
 * клипов. Экспортируется, чтобы юнит-тест мог прокрутить ровно один плеер,
 * не поднимая общий список.
 */
export function advancePlayer(player, dtMs) {
    if (!player || player.destroyed) return;
    const step = playerStepMs(player, dtMs);
    if (!(step > 0) || player.pausedFlag || player.slots.size === 0) return;
    const prev = player.clock_ms;
    const k = player.speedValue;
    player.clock_ms += step * k;

    const layers = Array.from(player.slots.values());
    for (const layer of layers) player.fireRange(layer, prev, player.clock_ms, 'normal', null);
    player.applyValues();

    for (const layer of layers) {
        const state = playheadState(layerTime(player, layer), layer.timeline.duration, layer.loop);
        if (!state.ended) continue;
        if (player.slots.get(layer.slot) === layer) player.slots.delete(layer.slot);
        finishLayer(player, layer, 'completed');
        const payload = { clip: layer.timeline, clipName: layer.timeline.name, player, reason: 'completed' };
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
 * поэтому при --fixed-dt прогон воспроизводится кадр в кадр. Плееры с
 * clock: 'presentation' берут сырое время кадра сами и потому тикают даже
 * при нулевом игровом dt (пауза/hit-stop).
 */
export function tickAnimPlayer(dt) {
    const ms = dt > 0 ? dt * 1000 : 0;
    tick_list.length = 0;
    let presentation = false;
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        if (player.clockValue === 'presentation') presentation = true;
        tick_list.push(player);
    }
    if (!(ms > 0) && !presentation) return;
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
    /** Объявить клип плеера: { duration (мс), loop, speed, clock, tracks, events }. */
    anim.clip = function (name, spec) {
        timelines.set(String(name), normalizeTimeline(name, spec));
        return $;
    };
    anim.clipGet = (name) => timelines.get(String(name)) || null;
    anim.clips = () => Array.from(timelines.keys());
    anim.removeClip = (name) => timelines.delete(String(name));
    anim.clearClips = () => { timelines.clear(); return $; };

    /**
     * Загрузить клипы из открытых данных (JSON-строка, объект клипа,
     * `{ clips: { name: spec } }` или массив). Каждая дорожка воспроизводится
     * без ручного frame-callback: события зовут зарегистрированные действия,
     * звук запускается audio-дорожкой.
     */
    anim.load = function (data) {
        let src = data;
        if (typeof src === 'string') {
            try { src = JSON.parse(src); }
            catch (e) {
                ctx.log(`$.anim.load: JSON не разобран (${e})`);
                return $;
            }
        }
        const items = [];
        if (Array.isArray(src)) {
            for (const item of src) items.push(item);
        } else if (isObject(src) && isObject(src.clips)) {
            for (const name of Object.keys(src.clips)) {
                items.push(Object.assign({ name }, src.clips[name]));
            }
        } else if (isObject(src)) {
            items.push(src);
        }
        for (const item of items) {
            if (!isObject(item)) continue;
            const name = item.name !== undefined ? item.name : item.clip;
            if (name === undefined || name === null) {
                ctx.log('$.anim.load: у клипа нет name — пропускаю');
                continue;
            }
            anim.clip(String(name), item);
        }
        return $;
    };
    anim.clipJSON = anim.load;

    // --- §41: binding'и и действия ----------------------------------------
    /** Зарегистрировать адаптер свойства: `{ kind, resolve, apply }`. */
    anim.bind = (name, adapter) => registerBinding(name, adapter);
    anim.bindings = () => bindingNames();
    /** Зарегистрировать действие для method-дорожки (без eval строки). */
    anim.action = (name, fn) => { registerAction(name, fn); return $; };
    anim.actions = () => actionNames();
    anim.actionRemove = (name) => actions.delete(String(name));

    // --- §41: сериализованный клип ----------------------------------------
    /** Нормализованные маркеры клипа (id, policy, окна) — для инструментов. */
    anim.markers = (name) => {
        const timeline = timelines.get(String(name));
        if (!timeline) return [];
        const out = [];
        for (const ev of timeline.events) {
            out.push({
                id: markerId(ev), name: ev.name, at: ev.at, kind: ev.kind,
                window: ev.window, windowPhase: ev.windowPhase,
                irreversible: ev.irreversible === true, policy: ev.policy,
            });
        }
        for (const cue of timeline.cues) {
            out.push({
                id: markerId(cue), name: cue.action || cue.name || cue.type, at: cue.at,
                kind: cue.kind, irreversible: cue.irreversible === true, policy: cue.policy,
            });
        }
        return out;
    };

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
    anim.interrupt = (clipName) => { defaultPlayer().interrupt(clipName); return anim; };
    anim.stopAll = () => {
        for (const player of players.slice()) player.stop();
        return anim;
    };
    anim.seek = (ms, opts) => { defaultPlayer().seek(ms, opts); return anim; };
    anim.skip = (ms, opts) => { defaultPlayer().skip(ms, opts); return anim; };
    anim.restore = (ms, opts) => { defaultPlayer().restore(ms, opts); return anim; };
    anim.reset = () => { defaultPlayer().reset(); return anim; };
    anim.clock = (value) => {
        if (value === undefined) return defaultPlayer().clock();
        defaultPlayer().clock(value);
        return anim;
    };
    anim.window = (name) => defaultPlayer().window(name);
    anim.openWindows = () => defaultPlayer().openWindows();
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
