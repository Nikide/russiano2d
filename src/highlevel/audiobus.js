// ===========================================================================
// Аудио-шины и эффекты: $.audio — аналог AudioServer/AudioBusLayout +
// AudioEffect из Godot 4, но поверх уже готовых вызовов `engine.audio.*`.
//
// Зачем отдельный слой: движок умеет громкость, панораму и эффект на КАНАЛЕ,
// но не знает про именованные шины. Шину строим в JS: `$.audio` маршрутизирует
// звук, хранит дерево шин (master → music → ui), а при смене громкости шины
// немедленно пересчитывает громкость всех её ЖИВЫХ каналов через
// `engine.audio.setChannelVolume` — в этом смысл C-расширения. Эффект шины
// так же накладывается на каналы её звуков через `setChannelEffect`.
//
// Что важно помнить при чтении:
//   * master — корень дерева и общая громкость движка, отдельной шиной он не
//     заводится: движок и так умножает мастер на весь микс, дублировать его в
//     громкости канала нельзя;
//   * `effectiveGain()` считает произведение громкостей по цепочке родителей,
//     а шину `master`, если она есть в переданном наборе, тоже учитывает —
//     поэтому функция пригодна и для чистых тестов, и для отладки;
//   * эффектов в SDL_mixer 3.2 три: `none`, `lowpass`, `echo`. Реверберация
//     помещения живёт отдельно и глобально (Freeverb в C + модуль acoustics.js:
//     $.audio.room/zone/listener) — комната звучит для всего микса сразу, а не
//     для отдельной шины.
//
// Контракт модуля: installAudiobus($) и tickAudiobus(dt).
// Чистые функции effectiveGain() и panAndGain() экспортируются наружу — их
// гоняет qjs-харнесс без движка.
// ===========================================================================

import { ctx, query } from './core.js';
import { tweenProps } from './tween.js';

// ---------------------------------------------------------------------------
// Состояние подсистемы (модульное: tickAudiobus не получает $)
// ---------------------------------------------------------------------------

const buses = new Map();      // имя шины → { name, volume, muted, solo, parent, effect, effectParams }
const handles = [];           // живые handle'ы всех звуков, запущенных через $.audio
const fades = [];             // активные затухания громкости (ведутся твинами)

let api_$ = null;             // ссылка на $, нужна для $.sound.play / $.sound.volume
let manual_listener = null;   // ручной слушатель { x, y }; иначе — позиция камеры
let installed = false;
// Режим позиционирования: 'js' — панорама и громкость считает JS (по умолчанию),
// 'sdl' — координаты отдаются SDL_mixer (MIX_SetTrack3DPosition), и затухание
// с раскладкой по колонкам считает он сам.
ctx.audio_spatial = ctx.audio_spatial || 'js';

const DEFAULT_BUS = 'sfx';
const DEFAULT_MAX_DISTANCE = 700;

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : (n > 1 ? 1 : n);
}

function clampPan(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < -1 ? -1 : (n > 1 ? 1 : n);
}

function log(message) {
    if (ctx && typeof ctx.log === 'function') ctx.log(message);
}

/** Аудио поднято? Проверяем каждый вызов: при R2D_ENABLE_AUDIO=OFF методов нет. */
function audio() {
    return (typeof engine !== 'undefined' && engine && engine.audio) ? engine.audio : null;
}

/**
 * Нормализует параметры эффекта в пару (p1, p2) для setChannelEffect и
 * setGroupEffect. Список видов — из движка (`$.audio.effects()`), здесь только
 * разбор понятных игроку имён в числа.
 */
function effectArgs(kind, params) {
    const p = params || {};
    const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    if (kind === 'lowpass' || kind === 'highpass') {
        const def = kind === 'lowpass' ? 1200 : 200;
        const cutoff = p.freq !== undefined ? p.freq : (p.cutoff !== undefined ? p.cutoff : def);
        return [num(cutoff, def), 0];
    }
    if (kind === 'echo') {
        const delay = p.delay !== undefined ? p.delay : 250;
        const feedback = p.feedback !== undefined ? p.feedback : (p.repeat !== undefined ? p.repeat : 0.35);
        // Доля повтора ограничена движком: 0..0.9, иначе эхо уходит в разнос.
        return [num(delay, 250), Math.max(0, Math.min(0.9, num(feedback, 0)))];
    }
    if (kind === 'tremolo') {
        // rate — колебаний в секунду, depth — глубина 0..1.
        return [num(p.rate !== undefined ? p.rate : p.freq, 5),
                Math.max(0, Math.min(1, num(p.depth, 0.5)))];
    }
    if (kind === 'bitcrush') {
        // bits — разрядность квантования, downsample — во сколько раз реже брать отсчёт.
        return [num(p.bits !== undefined ? p.bits : p.amount, 6),
                Math.max(1, Math.min(64, num(p.downsample !== undefined ? p.downsample : p.step, 1)))];
    }
    if (kind === 'ringmod') {
        return [num(p.freq !== undefined ? p.freq : p.rate, 220),
                Math.max(0, Math.min(1, num(p.mix, 1)))];
    }
    if (kind === 'reverb') {
        // Посыл: send — доля сигнала, уходящая в хвост, room — размер помещения.
        // Полные параметры хвоста берёт setGroupReverb/setChannelReverb.
        const send = p.send !== undefined ? p.send : (p.wet !== undefined ? p.wet : 0.35);
        return [Math.max(0, Math.min(1, num(send, 0.35))),
                Math.max(0, Math.min(1, num(p.room, 0.5)))];
    }
    return [0, 0];
}

/** Параметры хвоста для setGroupReverb/setChannelReverb. */
function reverbArgs(params) {
    const p = params || {};
    const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    const send = p.send !== undefined ? p.send : (p.wet !== undefined ? p.wet : 0.35);
    return [Math.max(0, Math.min(1, num(send, 0.35))),
            Math.max(0, Math.min(1, num(p.room, 0.5))),
            Math.max(0, Math.min(1, num(p.damp, 0.4))),
            Math.max(0, Math.min(1, num(p.width, 0.8)))];
}

/** Единый доступ к шине: Map и обычный объект-словарь обрабатываются одинаково. */
function busGet(collection, name) {
    if (!collection) return null;
    if (typeof collection.get === 'function') return collection.get(name) || null;
    const bus = collection[name];
    return bus === undefined ? null : bus;
}

function busEach(collection, fn) {
    if (!collection) return;
    if (typeof collection.get === 'function' && typeof collection.forEach === 'function') {
        collection.forEach((bus, name) => fn(bus, name));
        return;
    }
    for (const name of Object.keys(collection)) fn(collection[name], name);
}

/** Идёт ли цепочка родителей от `from` вверх до `target`. */
function reaches(bus, from, target) {
    let cur = from;
    const seen = new Set();
    while (cur) {
        if (cur === target) return true;
        if (seen.has(cur)) return false;
        seen.add(cur);
        const parent = busGet(bus, cur);
        cur = parent ? (parent.parent || 'master') : null;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Чистые функции (тестируются qjs без движка)
// ---------------------------------------------------------------------------

/**
 * Эффективная громкость шины `name`: произведение громкостей по цепочке
 * родителей, с учётом mute и solo.
 *
 * `collection` — Map или словарь `{ имя: { volume, muted, solo, parent } }`.
 * Если в наборе есть шина `master`, её громкость тоже входит в произведение
 * (в рантайме движок применяет мастер сам, поэтому его в наборе нет).
 *
 * Solo: если хотя бы одна шина помечена solo, звучат только она, её потомки и
 * её предки; все остальные получают 0. Так соло-шина не отрезается от мастера
 * и не глушит собственные дочерние шины.
 */
export function effectiveGain(collection, name) {
    if (!name) return 1;
    const get = (n) => busGet(collection, n);
    const target = String(name);

    const solo = [];
    busEach(collection, (bus, n) => { if (bus && bus.solo) solo.push(n); });

    if (solo.length > 0) {
        let audible = false;
        for (const s of solo) {
            if (target === s || reaches(collection, target, s) || reaches(collection, s, target)) {
                audible = true;
                break;
            }
        }
        if (!audible) return 0;
    }

    let gain = 1;
    let cur = target;
    const seen = new Set();
    while (cur) {
        if (cur === 'master') {
            const master = get('master');
            if (master && master.volume !== undefined) gain *= clamp01(master.volume);
            break;
        }
        if (seen.has(cur)) break;   // защита от цикла в дереве шин
        seen.add(cur);
        const bus = get(cur);
        if (!bus) break;            // шины нет — считаем её единицей
        if (bus.muted) return 0;
        gain *= bus.volume === undefined ? 1 : clamp01(bus.volume);
        cur = bus.parent || 'master';
    }
    return gain;
}

/**
 * Панорама и затухание источника относительно слушателя.
 *
 * `falloff` — число (максимальная слышимость, px) или `{ max }`.
 * Возвращает `{ pan, gain, dist }`: `pan` -1..1 (источник слева/справа),
 * `gain` 1 у слушателя и 0 на границе слышимости и дальше.
 */
export function panAndGain(listener, source, falloff) {
    const f = typeof falloff === 'number' ? { max: falloff } : (falloff || {});
    const max = Math.max(1e-3, Number(f.max) || DEFAULT_MAX_DISTANCE);
    const lx = listener && Number.isFinite(Number(listener.x)) ? Number(listener.x) : 0;
    const ly = listener && Number.isFinite(Number(listener.y)) ? Number(listener.y) : 0;
    const sx = source && Number.isFinite(Number(source.x)) ? Number(source.x) : 0;
    const sy = source && Number.isFinite(Number(source.y)) ? Number(source.y) : 0;
    const dx = sx - lx;
    const dy = sy - ly;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Панорама линейна по X; половина радиуса слышимости даёт полный разворот.
    const pan = clampPan(dx / (max * 0.5));
    const gain = dist >= max ? 0 : 1 - dist / max;
    return { pan, gain, dist };
}

// ---------------------------------------------------------------------------
// Шины
// ---------------------------------------------------------------------------

function createBus(name, opts) {
    const o = opts || {};
    const bus = {
        name,
        volume: o.volume === undefined ? 1 : clamp01(o.volume),
        muted: !!o.muted,
        solo: !!o.solo,
        parent: o.parent === undefined ? 'master' : String(o.parent),
        effect: o.effect === undefined ? 'none' : String(o.effect),
        effectParams: Object.assign({}, o.effectParams),
        // Настоящая шина движка: группа микшера. Её пост-микс обрабатывает DSP,
        // поэтому эффект шины действует и на звуки, запущенные позже.
        group: -1,
    };
    const a = audio();
    if (a && typeof a.group === 'function') {
        try { bus.group = a.group(name); } catch (e) { bus.group = -1; }
    }
    buses.set(name, bus);
    return bus;
}

/** Ставит канал в группу шины (если движок собрана с группами). */
function assignGroup(channel, bus) {
    const a = audio();
    if (!a || typeof a.setChannelGroup !== 'function' || !bus || bus.group < 0) return;
    try { a.setChannelGroup(channel, bus.group); } catch (e) { /* канал мог освободиться */ }
}

/**
 * Отдаёт координаты канала SDL_mixer (относительно слушателя — он у него в нуле).
 * Мир: X вправо, Y вниз. SDL: Y вверх, Z «вперёд-назад», поэтому плоскость
 * карты переводится как (dx, 0, dy): влево-вправо по X, дистанция — по обоим.
 */
function applySpatial(channel, dx, dy) {
    const a = audio();
    if (!a || typeof a.setChannel3D !== 'function') return;
    try { a.setChannel3D(channel, dx, 0, dy, true); } catch (e) { /* канал мог освободиться */ }
}

/** Создаёт цикл в дереве, если шине bus назначить родителя parent? */
function wouldCycle(bus, parent) {
    let cur = parent;
    const seen = new Set();
    while (cur && cur !== 'master') {
        if (cur === bus.name) return true;
        if (seen.has(cur)) return true;
        seen.add(cur);
        const p = buses.get(cur);
        cur = p ? p.parent : null;
    }
    return false;
}

function applyBusOpts(bus, opts) {
    if (opts.volume !== undefined) bus.volume = clamp01(opts.volume);
    if (opts.muted !== undefined) bus.muted = !!opts.muted;
    if (opts.solo !== undefined) bus.solo = !!opts.solo;
    if (opts.parent !== undefined) {
        const parent = String(opts.parent);
        if (parent === bus.name || wouldCycle(bus, parent)) {
            log(`$.audio.bus("${bus.name}"): родитель "${parent}" создаёт цикл — игнорирую`);
        } else {
            bus.parent = parent;
        }
    }
    if (opts.effect !== undefined) bus.effect = String(opts.effect);
    if (opts.effectParams !== undefined) {
        bus.effectParams = Object.assign({}, bus.effectParams, opts.effectParams);
    }
}

/** Возвращает шину, создавая её при необходимости (play без bus идёт в sfx). */
function resolveBus(name) {
    const n = (name === undefined || name === null || name === '') ? DEFAULT_BUS : String(name);
    let bus = buses.get(n);
    if (!bus) bus = createBus(n, {});
    return bus;
}

// ---------------------------------------------------------------------------
// Применение состояния шин к каналам
// ---------------------------------------------------------------------------

/** Громкость канала = личная громкость handle × эффективная громкость шины. */
function applyChannel(handle) {
    const a = audio();
    if (!a || typeof a.setChannelVolume !== 'function') return;
    if (handle.channel < 0) return;
    const gain = effectiveGain(buses, handle.bus);
    try { a.setChannelVolume(handle.channel, clamp01(handle.baseVolume * gain)); } catch (e) { /* звук мог закончиться */ }
}

/** Пересчитать все живые звуки — после смены громкости/mute/solo любой шины. */
function reapplyAll() {
    for (const handle of handles) applyChannel(handle);
}

/** Эффект шины. Если движок умеет группы — вешаем его на пост-микс группы. */
function applyBusEffect(name) {
    const bus = buses.get(name);
    if (!bus) return;
    const a = audio();
    const [p1, p2] = effectArgs(bus.effect, bus.effectParams);

    if (a && typeof a.setGroupEffect === 'function' && bus.group >= 0) {
        if (bus.effect === 'reverb' && typeof a.setGroupReverb === 'function') {
            // Реверб-шина: у группы свой хвост, доля send её микса уходит в него.
            const [send, room, damp, width] = reverbArgs(bus.effectParams);
            try { a.setGroupReverb(bus.group, send, room, damp, width); } catch (e) { /* шина могла исчезнуть */ }
            return;
        }
        try { a.setGroupEffect(bus.group, bus.effect, p1, p2); } catch (e) { /* шина могла исчезнуть */ }
        return;
    }

    // Движок без групп (заглушка звука): запасной путь — по каналам, как раньше.
    if (!a || typeof a.setChannelEffect !== 'function') return;
    for (const handle of handles) {
        if (handle.bus !== name || handle.channel < 0 || handle.fx !== null) continue;
        try { a.setChannelEffect(handle.channel, bus.effect, p1, p2); } catch (e) { /* канал мог освободиться */ }
    }
}

function applyEffectToHandle(handle) {
    const a = audio();
    if (!a || typeof a.setChannelEffect !== 'function' || handle.channel < 0) return;
    const bus = buses.get(handle.bus);
    // Если шина — настоящая группа, её эффект уже применён к миксу шины, и
    // дублировать его на канале нельзя: получится двойная обработка.
    const busOnGroup = !!bus && bus.group >= 0 && typeof a.setGroupEffect === 'function';
    const kind = handle.fx !== null ? handle.fx : (busOnGroup ? 'none' : (bus ? bus.effect : 'none'));
    const params = handle.fx !== null ? handle.fxParams : (busOnGroup ? {} : (bus ? bus.effectParams : {}));
    if (kind === 'reverb' && typeof a.setChannelReverb === 'function') {
        const [send, room, damp, width] = reverbArgs(params);
        try { a.setChannelReverb(handle.channel, send, room, damp, width); } catch (e) { /* канал свободен */ }
        return;
    }
    const [p1, p2] = effectArgs(kind, params);
    try { a.setChannelEffect(handle.channel, kind, p1, p2); } catch (e) { /* канал мог освободиться */ }
}

// ---------------------------------------------------------------------------
// Handle живого звука
// ---------------------------------------------------------------------------

function removeHandle(handle) {
    const i = handles.indexOf(handle);
    if (i >= 0) handles.splice(i, 1);
    for (let k = fades.length - 1; k >= 0; k--) {
        if (fades[k].target === handle) fades.splice(k, 1);
    }
}

function makeHandle(what, busName, channel, baseVolume, pan) {
    const handle = {
        channel,
        bus: busName,
        path: what,
        // Громкость до умножения на шину; движок хранит итоговую.
        baseVolume,
        basePan: clampPan(pan),
        // null — эффект берётся с шины; иначе личная настройка handle.
        fx: null,
        fxParams: {},

        /** Остановить звук. fadeMs > 0 — плавно гасит канал средствами движка. */
        stop(fadeMs) {
            const a = audio();
            if (handle.channel >= 0 && a && typeof a.stop === 'function') {
                try { a.stop(handle.channel, Number(fadeMs) || 0); } catch (e) { /* уже остановлен */ }
            }
            removeHandle(handle);
            return handle;
        },

        volume(value) {
            if (value === undefined) return handle.baseVolume;
            handle.baseVolume = clamp01(value);
            applyChannel(handle);
            return handle;
        },

        pan(value) {
            if (value === undefined) return handle.basePan;
            handle.basePan = clampPan(value);
            const a = audio();
            if (handle.channel >= 0 && a && typeof a.setChannelPan === 'function') {
                try { a.setChannelPan(handle.channel, handle.basePan); } catch (e) { /* канал свободен */ }
            }
            return handle;
        },

        effect(kind, params) {
            if (kind === undefined) {
                if (handle.fx !== null) return handle.fx;
                const bus = buses.get(handle.bus);
                return bus ? bus.effect : 'none';
            }
            handle.fx = String(kind);
            if (params !== undefined) handle.fxParams = Object.assign({}, handle.fxParams, params);
            applyEffectToHandle(handle);
            return handle;
        },

        playing() {
            const a = audio();
            if (handle.channel < 0 || !a || typeof a.playing !== 'function') return false;
            try { return !!a.playing(handle.channel); } catch (e) { return false; }
        },
    };
    return handle;
}

/** Запускает звук и ставит его под управление шины. Никогда не бросает. */
function spawn(what, busName, volume, pan, loop) {
    const bus = resolveBus(busName);
    let channel = -1;
    if (api_$ && api_$.sound && typeof api_$.sound.play === 'function') {
        try {
            channel = api_$.sound.play(what, {
                volume: clamp01(volume) * effectiveGain(buses, bus.name),
                pan: clampPan(pan),
                loop: !!loop,
            });
        } catch (e) {
            // Битый путь или выключенный звук не должны ронять кадр.
            channel = -1;
            log(`$.audio.play: звук "${what}" не запустился (${e})`);
        }
    }
    const handle = makeHandle(what, bus.name, channel, clamp01(volume), pan);
    // Движок переиспользует освободившиеся каналы: если старый handle ещё не
    // успели вычистить, снимаем его, иначе он будет менять громкость чужому звуку.
    if (channel >= 0) {
        for (let i = handles.length - 1; i >= 0; i--) {
            if (handles[i].channel === channel) removeHandle(handles[i]);
        }
    }
    handles.push(handle);
    if (channel >= 0) {
        // Сначала шина: эффект живёт на группе, канал лишь приписан к ней.
        assignGroup(channel, bus);
        applyChannel(handle);
        applyEffectToHandle(handle);
    }
    return handle;
}

/** Убирает из списка handle'ы, чьи каналы движок уже освободил (утечка закрыта). */
function pruneHandles() {
    const a = audio();
    if (!a || typeof a.playing !== 'function') return;
    for (let i = handles.length - 1; i >= 0; i--) {
        const handle = handles[i];
        let alive = false;
        if (handle.channel >= 0) {
            try { alive = !!a.playing(handle.channel); } catch (e) { alive = true; }
        }
        if (!alive) removeHandle(handle);
    }
}

// ---------------------------------------------------------------------------
// Затухания громкости (ведутся твинами, без блокировки кадра)
// ---------------------------------------------------------------------------

function fadeValue(target, key, to, ms, onChange) {
    if (!target) return;
    const dest = clamp01(to);
    const duration = Math.max(0, Number(ms) || 0);
    if (duration <= 0) {
        target[key] = dest;
        onChange(dest);
        return;
    }
    // Для одного и того же объекта держим только одно затухание, иначе они
    // начнут спорить за громкость и результат будет зависеть от порядка тиков.
    for (let i = fades.length - 1; i >= 0; i--) {
        if (fades[i].target === target && fades[i].key === key) fades.splice(i, 1);
    }
    const holder = { attrs: { level: Number(target[key]) || 0 } };
    const rec = {
        target,
        key,
        holder,
        done: false,
        apply(value) { target[key] = clamp01(value); onChange(target[key]); },
    };
    fades.push(rec);
    // Твин пишет в holder.attrs.level; tickAudiobus переносит значение в шину.
    tweenProps(holder, { level: dest }, duration, 'linear').then(() => {
        applyDirect(target, key, dest, onChange);
        rec.done = true;
    });
}

function applyDirect(target, key, value, onChange) {
    target[key] = clamp01(value);
    onChange(target[key]);
}

// ---------------------------------------------------------------------------
// Установка пространства имён $.audio
// ---------------------------------------------------------------------------

export function installAudiobus($) {
    if (installed && api_$ === $) return $.audio;
    api_$ = $;
    installed = true;
    buses.clear();
    handles.length = 0;
    fades.length = 0;
    manual_listener = null;

    /** Точка прослушивания: ручной слушатель (точка, узел или селектор) или камера. */
    function listenerPoint() {
        const m = manual_listener;
        if (m) {
            if (typeof m === 'string') {
                const n = query(m)[0];
                if (n) return { x: n.x, y: n.y };
            } else if (m.nodes) {
                const n = m.nodes[0];
                if (n) return { x: n.x, y: n.y };
            } else if (m.tag) {
                return { x: m.x, y: m.y };
            } else if (typeof m.x === 'number') {
                return m;
            }
        }
        if (ctx.camera && typeof ctx.camera.pos === 'function') return ctx.camera.pos();
        return { x: 0, y: 0 };
    }

    function pointOf(at) {
        if (Array.isArray(at)) return { x: Number(at[0]) || 0, y: Number(at[1]) || 0 };
        if (at && typeof at === 'object') return { x: Number(at.x) || 0, y: Number(at.y) || 0 };
        return { x: 0, y: 0 };
    }

    function masterVolume(value) {
        if (!api_$.sound || typeof api_$.sound.volume !== 'function') return value === undefined ? 1 : audioNs;
        if (value === undefined) return api_$.sound.volume();
        api_$.sound.volume(clamp01(value));
        return audioNs;
    }

    // Локальный кэш: движок не отдаёт sfx/music-громкость обратно (нет геттера).
    let sfx_level = 1;
    let music_level = 1;

    function stopBus(name, fadeMs) {
        const n = String(name);
        // Гасим не только саму шину, но и всё, что в неё маршрутизировано.
        for (let i = handles.length - 1; i >= 0; i--) {
            const h = handles[i];
            if (h.bus === n || reaches(buses, h.bus, n)) h.stop(fadeMs);
        }
        return audioNs;
    }

    const audioNs = {
        // --- Шины -----------------------------------------------------------

        /** Создать или получить шину. Возвращает саму шину (живой объект). */
        bus(name, opts) {
            const n = String(name);
            if (n === 'master') {
                log('$.audio.bus: "master" — корень дерева и общая громкость, отдельная шина не нужна');
                return null;
            }
            let bus = buses.get(n);
            if (!bus) {
                bus = createBus(n, opts);
                if (opts) { reapplyAll(); applyBusEffect(n); }
                return bus;
            }
            if (opts) {
                applyBusOpts(bus, opts);
                reapplyAll();
                applyBusEffect(n);
            }
            return bus;
        },

        /** Список шин с состоянием (копии: менять через $.audio). */
        buses() {
            const out = [];
            buses.forEach((b) => out.push({
                name: b.name,
                volume: b.volume,
                muted: b.muted,
                solo: b.solo,
                parent: b.parent,
                effect: b.effect,
                effectParams: Object.assign({}, b.effectParams),
            }));
            return out;
        },

        /** Удалить шину; её дети переподчиняются родителю удалённой. */
        remove(name) {
            const n = String(name);
            const bus = buses.get(n);
            if (!bus) return audioNs;
            buses.forEach((child) => { if (child.parent === n) child.parent = bus.parent || 'master'; });
            buses.delete(n);
            reapplyAll();
            return audioNs;
        },

        /** Снять все шины, остановить их звуки, вернуть слушателя камере. */
        clear() {
            for (const handle of handles.slice()) handle.stop(0);
            buses.clear();
            fades.length = 0;
            manual_listener = null;
            return audioNs;
        },

        // --- Громкость, mute, solo -----------------------------------------

        volume(nameOrValue, value) {
            if (typeof nameOrValue === 'number' && value === undefined) {
                masterVolume(nameOrValue);
                return audioNs;
            }
            if (nameOrValue === undefined) return masterVolume();
            const n = String(nameOrValue);
            if (n === 'master') {
                if (value === undefined) return masterVolume();
                return masterVolume(value);
            }
            let bus = buses.get(n);
            if (!bus) {
                if (value === undefined) return 1;     // шины нет — считаем единицей
                bus = createBus(n, {});
            }
            if (value === undefined) return bus.volume;
            bus.volume = clamp01(value);
            reapplyAll();
            return audioNs;
        },

        mute(name, flag) {
            const bus = buses.get(String(name));
            if (!bus) return flag === undefined ? false : audioNs;
            if (flag === undefined) return bus.muted;
            bus.muted = !!flag;
            reapplyAll();
            return audioNs;
        },

        solo(name, flag) {
            const bus = buses.get(String(name));
            if (!bus) return flag === undefined ? false : audioNs;
            if (flag === undefined) return bus.solo;
            bus.solo = !!flag;
            reapplyAll();
            return audioNs;
        },

        // --- Эффекты --------------------------------------------------------

        /** kind: 'none' | 'lowpass' | 'highpass' | 'echo' | 'tremolo' | 'bitcrush' |
 *  'ringmod' | 'reverb' (см. $.audio.effects()). Без kind — текущий эффект шины. */
        effect(name, kind, params) {
            const n = String(name);
            let bus = buses.get(n);
            if (!bus) {
                if (kind === undefined) return 'none';
                bus = createBus(n, {});
            }
            if (kind === undefined) return bus.effect;
            bus.effect = String(kind);
            if (params !== undefined) bus.effectParams = Object.assign({}, bus.effectParams, params);
            applyBusEffect(n);
            return audioNs;
        },

        /** Доступные имена эффектов — из движка, а не из зашитого списка. */
        effects() {
            const a = audio();
            const out = [];
            if (a && typeof a.effectCount === 'function' && typeof a.effectName === 'function') {
                const n = Number(a.effectCount()) || 0;
                for (let i = 0; i < n; i++) out.push(String(a.effectName(i)));
            }
            return out.length > 0 ? out : ['none', 'lowpass', 'echo'];
        },

        /** Эффективная громкость шины (с родителями, mute и solo) — для отладки. */
        gain(name) { return effectiveGain(buses, String(name)); },

        // --- Запуск звука ---------------------------------------------------

        /**
         * play('hit.ogg', { bus, volume, pan, loop, at: [x,y], falloff })
         * → handle живого звука. Без шины звук идёт в 'sfx'.
         */
        play(what, opts) {
            const o = opts || {};
            const busName = o.bus === undefined ? DEFAULT_BUS : String(o.bus);
            let volume = o.volume === undefined ? 1 : Number(o.volume);
            let pan = o.pan === undefined ? 0 : Number(o.pan);
            if (o.at !== undefined) {
                const pg = panAndGain(listenerPoint(), pointOf(o.at), o.falloff);
                volume *= pg.gain;
                pan = pg.pan;
            }
            return spawn(what, busName, volume, pan, o.loop);
        },

        /** Позиционный звук: панорама и затухание от слушателя/камеры. */
        playAt(what, x, y, opts) {
            const o = opts || {};
            const busName = o.bus === undefined ? DEFAULT_BUS : String(o.bus);
            const px = Number(x) || 0;
            const py = Number(y) || 0;

            // 3D-режим: координаты уходят в SDL_mixer, он сам считает и
            // затухание, и раскладку по колонкам.
            if (ctx.audio_spatial === 'sdl') {
                const l = listenerPoint();
                const handle = spawn(what, busName, o.volume === undefined ? 1 : Number(o.volume), 0, o.loop);
                if (handle.channel >= 0) applySpatial(handle.channel, px - l.x, py - l.y);
                return handle;
            }

            const pg = panAndGain(listenerPoint(), { x: px, y: py }, o.falloff);
            const volume = (o.volume === undefined ? 1 : Number(o.volume)) * pg.gain;
            return spawn(what, busName, volume, pg.pan, o.loop);
        },

        /**
         * Режим позиционирования.
         *   'js'  — панорама и громкость считает JS (по умолчанию);
         *   'sdl' — координаты отдаются SDL_mixer: слушатель у него всегда в
         *           (0,0,0), поэтому передаются координаты относительно него.
         */
        spatial(mode) {
            if (mode === undefined) return ctx.audio_spatial;
            if (mode !== 'js' && mode !== 'sdl') {
                log(`$.audio.spatial: неизвестный режим "${mode}" — остаётся ${ctx.audio_spatial}`);
                return audioNs;
            }
            ctx.audio_spatial = mode;
            if (mode === 'js') {
                const a = audio();
                if (a && typeof a.setChannel3D === 'function') {
                    for (const handle of handles) {
                        if (handle.channel >= 0) {
                            try { a.setChannel3D(handle.channel, 0, 0, 0, false); } catch (e) { /* канал свободен */ }
                        }
                    }
                }
            }
            return audioNs;
        },

        /**
         * Слушатель: без аргументов — текущая точка { x, y }; с координатами —
         * ручная точка; с узлом или селектором — слушатель едет вместе с ним.
         */
        listener(x, y) {
            if (x === undefined) return listenerPoint();
            if (typeof x === 'string') { manual_listener = x; return audioNs; }
            if (x && (x.nodes || x.tag)) { manual_listener = x; return audioNs; }
            if (x && typeof x === 'object') manual_listener = { x: Number(x.x) || 0, y: Number(x.y) || 0 };
            else manual_listener = { x: Number(x) || 0, y: Number(y) || 0 };
            return audioNs;
        },

        // --- Живые ручки ----------------------------------------------------

        /** Активные звуки, запущенные через $.audio. */
        handles() { return handles.slice(); },

        /** Остановить все звуки шины и её потомков (fadeMs — плавно). */
        stopBus(name, fadeMs) { return stopBus(name, fadeMs); },

        stopAll(fadeMs) {
            if (api_$.sound && typeof api_$.sound.stopAll === 'function') {
                api_$.sound.stopAll(fadeMs === undefined ? 0 : fadeMs);
            }
            handles.length = 0;
            fades.length = 0;
            return audioNs;
        },

        // --- Прокси к $.sound (без дублирования логики) --------------------

        masterVolume(value) { return masterVolume(value); },
        getMasterVolume() { return masterVolume(); },

        sfxVolume(value) {
            if (value === undefined) return sfx_level;
            sfx_level = clamp01(value);
            if (api_$.sound && typeof api_$.sound.sfxVolume === 'function') api_$.sound.sfxVolume(sfx_level);
            return audioNs;
        },

        musicVolume(value) {
            if (value === undefined) return music_level;
            music_level = clamp01(value);
            if (api_$.sound && typeof api_$.sound.musicVolume === 'function') api_$.sound.musicVolume(music_level);
            return audioNs;
        },

        // --- Затухания ------------------------------------------------------

        fadeBus(name, value, ms) {
            const bus = buses.get(String(name));
            if (!bus) return audioNs;
            fadeValue(bus, 'volume', value, ms, () => reapplyAll());
            return audioNs;
        },

        fadeHandle(handle, value, ms) {
            if (!handle || typeof handle !== 'object') return audioNs;
            fadeValue(handle, 'baseVolume', value, ms, () => applyChannel(handle));
            return audioNs;
        },
    };

    $.audio = audioNs;
    ctx.audio = audioNs;
    return audioNs;
}

// ---------------------------------------------------------------------------
// Кадровый хук
// ---------------------------------------------------------------------------

/**
 * Шаг шин: переносим значения активных затуханий в шины/handle'ы и убираем
 * звуки, которые движок уже доиграл (иначе список живых handle'ов течёт).
 */
export function tickAudiobus(dt) {
    const ms = Number(dt);
    if (Number.isFinite(ms) && ms < 0) return;   // защита от мусорного dt
    for (let i = fades.length - 1; i >= 0; i--) {
        const rec = fades[i];
        if (rec.done) { fades.splice(i, 1); continue; }
        rec.apply(rec.holder.attrs.level);
    }
    pruneHandles();
}
