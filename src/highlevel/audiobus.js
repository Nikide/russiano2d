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

import { engine } from './native.js';
import { ctx, query } from './core.js';
// Огибающие громкости музыкальных слоёв (§25) считаются по кадрам здесь же:
// кадровый тик аудио-подсистемы уже есть, второй не нужен.
import { tickStems, refreshStemGains } from './sound.js';
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
        // Группа кончилась (лимит движка) — это факт, о котором игра обязана
        // узнать: без группы у шины не будет ни эффекта, ни общего микса.
        if (!(bus.group >= 0)) {
            log(`$.audio.bus("${name}"): движок не выдал группу микшера (лимит шин) — `
                + 'громкость шины работает, эффект на её звуки не ляжет');
        }
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
    if (opts.volume !== undefined) bus.volume = volumeValue(opts.volume) ?? bus.volume;
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

// ---------------------------------------------------------------------------
// Громкость: линейно или в dB — явно
// ---------------------------------------------------------------------------
//
// Движок хранит линейный gain 0..1, а микшеры и художники меряют в dB.
// Чтобы «-6 dB» не превращалось молча в 0.06, значение можно передать
// объектом: `{ db: -6 }`. Здесь — единственный перевод.

/** Линейный gain → dB (0 → -Infinity, 1 → 0). */
export function linearToDb(value) {
    const v = Number(value);
    if (!(v > 0)) return -Infinity;
    return 20 * Math.log10(v);
}

/** dB → линейный gain 0..1 (значения выше 0 dB обрезаются единицей). */
export function dbToLinear(db) {
    const d = Number(db);
    if (!Number.isFinite(d)) return d > 0 ? 1 : 0;
    return Math.max(0, Math.min(1, Math.pow(10, d / 20)));
}

/** Значение громкости из числа (линейно) или `{ db }`. */
export function volumeValue(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'object') {
        if (value.db !== undefined) return dbToLinear(value.db);
        if (value.linear !== undefined) return clamp01(value.linear);
        return undefined;
    }
    return clamp01(value);
}

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
    // Музыкальные слои живут на отдельных дорожках (§25): их громкость тоже
    // зависит от шины, поэтому пересчитываем и её.
    refreshStemGains();
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
        // Приоритет вытеснения голоса (как его просили) и скорость: движок
        // хранит своё значение — сверять его надо с $.sound.priorityOf(channel).
        priority: 0,
        pitch: 1,

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
            handle.baseVolume = volumeValue(value) ?? handle.baseVolume;
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

        /**
         * Переключить звук на другую шину НА ХОДУ: `handle.toBus('music')`.
         *
         * Имя `toBus`, а не `bus`: `handle.bus` — строка с текущей шиной
         * (её читают игры и отчёты), и метод с тем же именем перекрыл бы её.
         *
         * Меняется только маршрут: личная громкость и панорама handle не
         * трогаются, а хвост прежнего маршрута не тянется за звуком —
         * состояние канального эффекта сбрасывается (эхо/реверб), затем
         * применяется эффект новой шины.
         */
        toBus(name) {
            if (name === undefined) return handle.bus;
            const target = resolveBus(name);
            if (target.name === handle.bus) return handle;
            const a = audio();
            // Сброс состояния канального эффекта: хвост прежней шины/канала
            // не должен звучать уже в новой маршрутизации.
            if (handle.channel >= 0 && a && typeof a.setChannelEffect === 'function') {
                try { a.setChannelEffect(handle.channel, 'none', 0, 0); } catch (e) { /* канал свободен */ }
            }
            handle.bus = target.name;
            if (handle.channel >= 0) {
                assignGroup(handle.channel, target);
                applyChannel(handle);
                applyEffectToHandle(handle);
            }
            return handle;
        },

        /** Шина, в которую звук маршрутизирован сейчас (синоним `handle.bus`). */
        busName() { return handle.bus; },

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

/**
 * Запускает звук и ставит его под управление шины. Никогда не бросает.
 *
 * `extra` — то, что относится к КАНАЛУ, а не к шине: `priority` (вытеснение
 * голосов), `pitch` (скорость) и `keep` (звук переживает выгрузку области).
 * Раньше эти поля не доходили до `$.sound.play`, и `$.audio.play(..., {
 * priority })` молча играл с приоритетом 0 — то есть ровно так, как если бы
 * приоритета не было: важная реплика вытеснялась первым же шагом по траве.
 */
function spawn(what, busName, volume, pan, loop, extra) {
    const bus = resolveBus(busName);
    const o = extra || {};
    let channel = -1;
    if (api_$ && api_$.sound && typeof api_$.sound.play === 'function') {
        const play_opts = {
            volume: clamp01(volume) * effectiveGain(buses, bus.name),
            pan: clampPan(pan),
            loop: !!loop,
        };
        if (o.priority !== undefined) play_opts.priority = Number(o.priority) || 0;
        if (o.pitch !== undefined) play_opts.pitch = o.pitch;
        if (o.keep === true) play_opts.keep = true;
        try {
            channel = api_$.sound.play(what, play_opts);
        } catch (e) {
            // Битый путь или выключенный звук не должны ронять кадр.
            channel = -1;
            log(`$.audio.play: звук "${what}" не запустился (${e})`);
        }
    }
    const handle = makeHandle(what, bus.name, channel, clamp01(volume), pan);
    handle.priority = o.priority === undefined ? 0 : (Number(o.priority) || 0);
    if (o.pitch !== undefined) handle.pitch = Number(o.pitch) || 1;
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
        const v = volumeValue(value);
        if (v !== undefined) api_$.sound.volume(v);
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

        /**
         * Удалить шину. Дети и ЖИВЫЕ ЗВУКИ шины переподчиняются её родителю
         * (иначе звук остался бы в освобождённой группе, а громкость считалась
         * бы от несуществующей шины). Группа движка освобождается вместе с её
         * эффектом и хвостом — чужие шины это не задевает.
         */
        remove(name) {
            const n = String(name);
            const bus = buses.get(n);
            if (!bus) return audioNs;
            const parent = bus.parent && bus.parent !== n ? bus.parent : 'master';
            buses.forEach((child) => { if (child.parent === n) child.parent = parent; });
            // Звуки: маршрут в родителя + перепривязка группы/эффекта.
            // 'master' — корень дерева, а не шина: у него нет группы, поэтому
            // канал просто отвязывается от группы удалённой шины.
            for (const handle of handles) {
                if (handle.bus !== n) continue;
                handle.bus = parent;
            }
            buses.delete(n);
            const a = audio();
            for (const handle of handles) {
                if (handle.channel < 0) continue;
                if (handle.bus === 'master' || !buses.has(handle.bus)) {
                    if (a && typeof a.setChannelGroup === 'function') {
                        try { a.setChannelGroup(handle.channel, -1); } catch (e) { /* канал свободен */ }
                    }
                } else {
                    assignGroup(handle.channel, buses.get(handle.bus));
                }
                applyChannel(handle);
                applyEffectToHandle(handle);
            }
            // Группу освобождаем последней: сначала из неё ушли все звуки.
            if (bus.group >= 0 && a && typeof a.destroyGroup === 'function') {
                try { a.destroyGroup(bus.group); } catch (e) { /* группа уже освобождена */ }
            }
            reapplyAll();
            return audioNs;
        },

        /**
         * Карта маршрутизации — для отладки, инструментов и тестов:
         * какая шина в какую группу идёт, какой у неё эффект и громкость.
         *
         * `globalRoom` — общий реверб микса (`$.audio.room`, акустика): он
         * действует на ВСЁ, включая сухие шины, поэтому `colored` у шины
         * показывает, окрасит ли её текущая маршрутизация. Для изоляции
         * держите комнату выключенной и включайте реверб на конкретной шине
         * (`effect('ambience', 'reverb', { send })`).
         */
        routes() {
            let room = null;
            const a = audio();
            if (a && typeof a.getRoom === 'function') {
                try { room = a.getRoom(); } catch (e) { room = null; }
            }
            const global_wet = !!(room && Number(room.wet) > 0);
            const out = [];
            buses.forEach((b) => {
                out.push({
                    name: b.name,
                    parent: b.parent,
                    group: b.group,
                    effect: b.effect,
                    effectParams: Object.assign({}, b.effectParams),
                    gain: effectiveGain(buses, b.name),
                    muted: !!b.muted,
                    solo: !!b.solo,
                    // Сухая шина под общей комнатой всё равно мокнет: это честно.
                    dry: b.effect === 'none',
                    colored: b.effect !== 'none' || global_wet,
                });
            });
            // Факт, а не догадка: общая комната микса действует на ВСЕ шины,
            // поэтому сухая шина под ней всё равно мокнет. Для изоляции
            // выключайте комнату и включайте реверб на конкретной шине.
            const warnings = [];
            if (global_wet) {
                for (const b of out) {
                    if (b.dry) warnings.push({ kind: 'dry-bus-under-global-room', bus: b.name });
                }
            }
            return { buses: out, globalRoom: room, globalRoomWet: global_wet, warnings };
        },

        /** Снять все шины, остановить их звуки, вернуть слушателя камере. */
        clear() {
            for (const handle of handles.slice()) handle.stop(0);
            // Группы микшера — ресурс движка (их всего 8). Без destroy они
            // выгорают: после нескольких `bus()` + `clear()` следующая шина
            // молча остаётся без группы, и её эффект не применяется вовсе.
            const a = audio();
            if (a && typeof a.destroyGroup === 'function') {
                buses.forEach((bus) => {
                    if (!(bus.group >= 0)) return;
                    try { a.destroyGroup(bus.group); } catch (e) { /* группа уже свободна */ }
                    bus.group = -1;
                });
            }
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
            bus.volume = volumeValue(value) ?? bus.volume;
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

        /**
         * Явный перевод громкости: `$.audio.dbToLinear(-6)` → 0.501,
         * `$.audio.linearToDb(0.5)` → -6.02. Все громкости в `$` — линейные;
         * сеттеры принимают и `{ db: -6 }`.
         */
        dbToLinear(db) { return dbToLinear(db); },
        linearToDb(value) { return linearToDb(value); },
        volumeOf(value) {
            const v = volumeValue(value);
            return v === undefined ? 1 : v;
        },

        // --- Запуск звука ---------------------------------------------------

        /**
         * play('hit.ogg', { bus, volume, pan, loop, at: [x,y], falloff })
         * → handle живого звука. Без шины звук идёт в 'sfx'.
         *
         * Поля канала идут и дальше, в `$.sound.play`: `priority` (при
         * нехватке голосов вытесняется самый неважный звук), `pitch`
         * (скорость) и `keep: true` (звук переживает выгрузку области).
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
            return spawn(what, busName, volume, pan, o.loop, o);
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
                const handle = spawn(what, busName, o.volume === undefined ? 1 : Number(o.volume), 0, o.loop, o);
                if (handle.channel >= 0) applySpatial(handle.channel, px - l.x, py - l.y);
                return handle;
            }

            const pg = panAndGain(listenerPoint(), { x: px, y: py }, o.falloff);
            const volume = (o.volume === undefined ? 1 : Number(o.volume)) * pg.gain;
            return spawn(what, busName, volume, pg.pan, o.loop, o);
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
            sfx_level = volumeValue(value) ?? sfx_level;
            if (api_$.sound && typeof api_$.sound.sfxVolume === 'function') api_$.sound.sfxVolume(sfx_level);
            return audioNs;
        },

        musicVolume(value) {
            if (value === undefined) return music_level;
            music_level = volumeValue(value) ?? music_level;
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
    tickStems(ms);
}
