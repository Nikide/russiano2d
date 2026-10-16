// ===========================================================================
// Звук: $.sound — эффекты, позиционное звучание, музыка.
//
// Позиционность приблизительная: SDL_mixer умеет панораму (pan -1..1) и
// громкость, поэтому «где звучит» вычисляется относительно камеры. Этого
// достаточно для 2D: источник слева — в левом ухе.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query } from './core.js';

/** Линейный gain → dB и обратно: отображение значения — дело вызывающего. */
export function linearToDb(value) {
    const v = Number(value);
    if (!(v > 0)) return -Infinity;
    return 20 * Math.log10(v);
}

export function dbToLinear(db) {
    const d = Number(db);
    if (!Number.isFinite(d)) return d > 0 ? 1 : 0;
    return Math.max(0, Math.min(1, Math.pow(10, d / 20)));
}

/** Значение громкости: число (линейно) или `{ db }` / `{ linear }`. */
export function levelValue(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'object') {
        if (value.db !== undefined) return dbToLinear(value.db);
        if (value.linear !== undefined) return Math.max(0, Math.min(1, Number(value.linear) || 0));
        return undefined;
    }
    const v = Number(value);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
}

// ---------------------------------------------------------------------------
// Музыкальные слои (§25): один transport на все stem'ы
// ---------------------------------------------------------------------------
//
// Старт, seek и pause идут ОДНОЙ нативной командой на все слои: по отдельным
// вызовам из JS слои разошлись бы на буфер микшера (проверено — расхождение
// видно в $.sound.stems().drift()). Огибающие громкости слоёв считает JS по
// кадрам (шаг кадра), сами позиции — нативные PCM-кадры.

const stem_transports = [];

function makeStemTransport(paths, opts) {
    const o = opts || {};
    const a = engine.audio;
    const list = [].concat(paths || []).filter((p) => p !== undefined && p !== null);
    if (list.length === 0 || !a || typeof a.stemsSet !== 'function') return null;
    const ids = list.map((p) => soundId(p));
    const count = a.stemsSet(ids);
    if (!count) return null;

    const layers = [];
    for (let i = 0; i < count; i++) {
        layers.push({ base: i === 0 ? 1 : 0, gain: i === 0 ? 1 : 0, from: i === 0 ? 1 : 0, target: i === 0 ? 1 : 0, ms: 0, t: 0 });
    }
    const transport = {
        paths: list.slice(),
        layers,
        // Поле и метод не могут называться одинаково: `bus` — МЕТОД смены
        // шины, поэтому сама шина живёт в `busName`.
        busName: o.bus === undefined ? 'music' : String(o.bus),
        loop: o.loop !== false,
        loopStart: Number(o.loopStart) || 0,
        loopEnd: Number(o.loopEnd) || 0,
        count() { return a.stemCount ? a.stemCount() : count; },

        /** Запустить все слои одной командой: общий sample-clock и петля. */
        play(startOpts) {
            const p = startOpts || {};
            const start_ms = p.start !== undefined ? Number(p.start) * 1000 : 0;
            const loop = p.loop === undefined ? transport.loop : !!p.loop;
            const loop_start = p.loopStart !== undefined ? Number(p.loopStart) : transport.loopStart;
            const loop_end = p.loopEnd !== undefined ? Number(p.loopEnd) : transport.loopEnd;
            transport.loop = loop;
            transport.loopStart = loop_start || 0;
            transport.loopEnd = loop_end || 0;
            a.stemsStart(loop, Number(p.fade) || 0, start_ms,
                         transport.loopStart * 1000, transport.loopEnd * 1000);
            transport._applyGains();
            return transport;
        },

        /** Перемотка всех слоёв в одну и ту же позицию (секунды). */
        seek(seconds) {
            if (typeof a.stemsSeek === 'function') a.stemsSeek(Number(seconds) || 0);
            return transport;
        },

        pause(flag) {
            if (typeof a.stemsPause === 'function') a.stemsPause(flag === undefined ? true : !!flag);
            return transport;
        },

        paused() {
            return typeof a.stemsPaused === 'function' ? !!a.stemsPaused() : false;
        },

        stop(fadeMs) {
            if (typeof a.stemsStop === 'function') a.stemsStop(Number(fadeMs) || 0);
            return transport;
        },

        playing() {
            return typeof a.stemsPlaying === 'function' ? !!a.stemsPlaying() : false;
        },

        /** Позиция слоя в секундах (-1 — слоя нет). */
        time(index) {
            if (typeof a.stemTime !== 'function') return -1;
            const i = index === undefined ? 0 : Math.floor(Number(index) || 0);
            return a.stemTime(i);
        },

        /** Позиция слоя в PCM-кадрах — точное число для сверки фазы. */
        frames(index) {
            if (typeof a.stemFrames !== 'function') return -1;
            const i = index === undefined ? 0 : Math.floor(Number(index) || 0);
            return Number(a.stemFrames(i));
        },

        /** Позиции всех слоёв в секундах. */
        times() {
            const out = [];
            for (let i = 0; i < transport.count(); i++) out.push(transport.time(i));
            return out;
        },

        /** Расхождение слоёв: максимум − минимум в миллисекундах (0 — в фазе). */
        drift() {
            const times = transport.times().filter((t) => t >= 0);
            if (times.length < 2) return 0;
            return (Math.max(...times) - Math.min(...times)) * 1000;
        },

        /**
         * Громкость слоя. `ms > 0` — плавно (огибающая по кадрам), иначе сразу.
         * Значение — линейно или `{ db }`.
         */
        layer(index, value, layerOpts) {
            const i = Math.floor(Number(index) || 0);
            const layer = layers[i];
            if (!layer) return transport;
            if (value === undefined) return layer.base;
            const v = levelValue(value);
            if (v === undefined) return transport;
            const ms = Number((layerOpts || {}).fade) || 0;
            layer.base = v;
            if (ms > 0) {
                layer.from = layer.gain;
                layer.target = v;
                layer.ms = ms;
                layer.t = 0;
            } else {
                layer.gain = v;
                layer.target = v;
                layer.ms = 0;
            }
            transport._applyGains();
            return transport;
        },

        /** Мгновенная громкость слоя (с учётом огибающей) — для тестов. */
        layerGain(index) {
            const layer = layers[Math.floor(Number(index) || 0)];
            return layer ? layer.gain : 0;
        },

        /** Названные слои одним вызовом: `{ battle: 1, calm: 0 }`. */
        gains(spec) {
            if (!spec) return transport;
            for (const key of Object.keys(spec)) {
                const i = transport.paths.indexOf(key);
                if (i >= 0) transport.layer(i, spec[key]);
            }
            return transport;
        },

        /**
         * Кроссфейд на слой `index`: он уходит в 1, остальные в 0, за `ms`
         * миллисекунд. Огибающая линейная, громкости слоёв в сумме не
         * превышают единицу — «двойной громкости» не возникает.
         */
        crossfade(index, ms) {
            const to = Math.floor(Number(index) || 0);
            for (let i = 0; i < layers.length; i++) {
                transport.layer(i, i === to ? 1 : 0, { fade: Number(ms) || 0 });
            }
            return transport;
        },

        /** Шина (§48): её громкость умножается на громкость слоя. */
        bus(name) {
            if (name === undefined) return transport.busName;
            transport.busName = String(name);
            transport._applyGains();
            return transport;
        },

        _busGain() {
            const audio = ctx.audio;
            if (!audio || typeof audio.gain !== 'function') return 1;
            try { return Number(audio.gain(transport.busName)) || 0; } catch (e) { return 1; }
        },

        _applyGains() {
            const bus = transport._busGain();
            for (let i = 0; i < layers.length; i++) {
                if (typeof a.setStemGain === 'function') a.setStemGain(i, layers[i].gain * bus);
            }
        },
    };
    stem_transports.push(transport);
    return transport;
}

/**
 * Пересчитать громкости слоёв (например, после смены громкости шины):
 * громкость слоя умножается на громкость ЕГО шины (§48).
 */
export function refreshStemGains() {
    for (const transport of stem_transports) transport._applyGains();
}

/** Шаг огибающих слоёв; зовётся из кадрового тика шин (tickAudiobus). */
export function tickStems(dt) {
    if (stem_transports.length === 0) return;
    const ms = Number(dt) * 1000;
    for (const transport of stem_transports) {
        let changed = false;
        for (const layer of transport.layers) {
            if (layer.ms <= 0) continue;
            layer.t += ms;
            const p = Math.min(1, layer.t / layer.ms);
            layer.gain = layer.from + (layer.target - layer.from) * p;
            if (p >= 1) { layer.gain = layer.target; layer.ms = 0; }
            changed = true;
        }
        if (changed) transport._applyGains();
    }
}


const loaded = new Map();     // путь → id звука

function soundId(what) {
    if (typeof what === 'number') return what;
    if (!what) return -1;
    if (loaded.has(what)) return loaded.get(what);
    // Расширение можно не писать: движок сам перебирает wav/ogg/mp3/flac.
    const id = engine.audio.load(what);
    loaded.set(what, id);
    if (id < 0) ctx.log(`$: не удалось загрузить звук "${what}"`);
    return id;
}

export function installSound($) {
    /**
     * Запись в журнал событий (§23, вкладка EVENTS): «звук поставлен/снят».
     * `$.trace.note` сам ничего не делает, когда трассировка выключена, поэтому
     * вызов безопасен на горячем пути.
     */
    function noteAudio(data) {
        if ($.trace && typeof $.trace.note === 'function') $.trace.note('audio', null, data);
    }

    /**
     * Взять канал под владение текущей области сцены: при её закрытии звук
     * глушится. Так выгрузка комнаты убирает и её звук, а не только узлы
     * (§8.2). Игра может оставить звук жить дольше области — `{ keep: true }`.
     *
     * Какую область считать текущей:
     *   * внутри `$.scene.scope('room', () => …)`, сборки prefab и комнаты
     *     (`$.room.enter`) движок ведёт `ctx.scope_current` — берём ЕГО, иначе
     *     звук комнаты уходил бы в чужую (анонимную) область и переживал
     *     выгрузку комнаты;
     *   * вне области — прежний анонимный владелец `$.scene.scope()`: так
     *     ведёт себя игра, играющая звук на верхнем уровне, и так её звук
     *     снимается вместе с областью загрузчика (`$.scene.load(..., {scope:true})`).
     */
    // Что запустила САМА сцена: каналы и музыка, взятые вне именованной области
    // и комнаты. При смене сцены (`$.scene.load`) они гаснут — как и обещает
    // модель владельца. Переживает переход только `{ keep: true }`.
    const scene_channels = new Set();
    let scene_music = false;
    let scene_fade_ms = 250;      // затухание по умолчанию, мс

    /**
     * Погасить всё, что запустила уходящая сцена. Возвращает число снятых
     * звуков (музыка считается за один) — это видно тесту и журналу.
     */
    function stopSceneOwned(fade) {
        const ms = fade === undefined ? scene_fade_ms : Math.max(0, Number(fade) || 0);
        let stopped = 0;
        for (const channel of scene_channels) {
            if (engine.audio.playing(channel)) {
                engine.audio.stop(channel, ms);
                stopped++;
            }
            scene_channels.delete(channel);
        }
        if (scene_music) {
            if (engine.audio.musicPlaying()) {
                engine.audio.stopMusic(ms);
                stopped++;
            }
            scene_music = false;
            if (ctx.state_music) ctx.state_music = null;
        }
        return stopped;
    }

    function ownChannel(channel, opts) {
        if (!(channel >= 0) || (opts && opts.keep === true)) return channel;
        const scene = ctx.scene;
        if (!scene || typeof scene.scope !== 'function') return channel;
        const current = ctx.scope_current;
        const scope = (current && typeof current.sound === 'function') ? current : scene.scope();
        if (scope && typeof scope.sound === 'function') scope.sound(channel, opts && opts.fade);
        // Владелец — область сцены (не именованная область и не комната): так
        // звук снимается вместе со сменой сцены, а не живёт до конца игры.
        if (!current) scene_channels.add(channel);
        return channel;
    }

    // Смена сцены зовёт это: сцена закончилась — её звук гаснет (с затуханием).
    ctx._stopSceneSound = stopSceneOwned;

    const sound = {
        /**
         * play('hit.wav', { volume, pan, loop, pitch, priority }) → id канала
         * или -1.
         *
         * `pitch` — скорость воспроизведения (1.0 обычная): и высота, и темп.
         *
         * `priority` — насколько звук важен (больше — важнее, 0 по умолчанию).
         * Когда все каналы заняты, движок вытесняет САМЫЙ НЕВАЖНЫЙ звук и
         * только если новый не менее важен; иначе возвращает -1. Раньше
         * жертвой всегда был канал 0, поэтому важная реплика глушилась первым
         * же шагом по траве.
         */
        play(what, opts) {
            const o = opts || {};
            const id = soundId(what);
            if (id < 0) return -1;
            const channel = engine.audio.play(id, o.volume === undefined ? 1 : o.volume,
                                              o.pan === undefined ? 0 : o.pan,
                                              o.loop ? 1 : 0,
                                              o.priority === undefined ? 0 : o.priority);
            // Скорость — свойство канала, а каналы переиспользуются. Поэтому
            // ставим её всегда: без этого следующий звук на том же канале
            // унаследовал бы чужой pitch.
            if (channel >= 0) engine.audio.setChannelPitch(channel, o.pitch === undefined ? 1 : o.pitch);
            if (channel >= 0) {
                ownChannel(channel, o);
                noteAudio({ action: 'play', name: String(what), channel,
                            loop: o.loop === true, volume: o.volume === undefined ? 1 : o.volume });
            }
            return channel;
        },

        /** Звук в точке мира: панорама по X относительно камеры, тише по Z. */
        playAt(what, where, opts) {
            const o = Object.assign({ max: 700 }, opts);
            const pos = toPoint(where, 'playAt');
            const cam = listenerPoint();
            const dx = pos.x - cam.x;
            const dy = pos.y - cam.y;
            const dist = Math.hypot(dx, dy);
            if (dist > o.max) return -1;

            let channel;
            if (ctx.audio_spatial === 'sdl') {
                // Координаты считает SDL_mixer: панораму и затухание отдаём ему.
                channel = sound.play(what, { volume: o.volume, loop: o.loop, pitch: o.pitch });
                if (channel >= 0 && engine.audio.setChannel3D) {
                    // Слушатель у SDL_mixer в нуле, поэтому координаты — разница.
                    engine.audio.setChannel3D(channel, dx, 0, dy, true);
                }
            } else {
                const pan = Math.max(-1, Math.min(1, dx / (o.max * 0.5)));
                const volume = (o.volume === undefined ? 1 : o.volume) * (1 - dist / o.max);
                channel = sound.play(what, Object.assign({}, o, { pan, volume: Math.max(0, volume), loop: o.loop }));
            }

            // Запоминаем источник: модуль акустики будет двигать панораму вслед
            // за узлом и глушить звук, ушедший за стену (docs/highlevel/audiobus.md).
            if (channel >= 0) {
                if (!ctx.sound_sources) ctx.sound_sources = new Map();
                const trackable = (typeof where === 'string') || (where && where.nodes && where.nodes.length);
                ctx.sound_sources.set(channel, {
                    x: pos.x, y: pos.y,
                    max: o.max,
                    volume: o.volume === undefined ? 1 : o.volume,
                    node: trackable ? where : null,
                });
            }
            return channel;
        },

        /** Музыка. crossfadeMs — плавно заменить текущую дорожку. */
        music(what, opts) {
            const music_opts = opts || {};
            if (music_opts.keep !== true) scene_music = true;
            const o = opts || {};
            const id = soundId(what);
            if (id < 0) return sound;
            engine.audio.setMusicPitch(o.pitch === undefined ? 1 : o.pitch);
            engine.audio.music(id, o.loop !== false, o.volume === undefined ? 1 : o.volume,
                               o.fade === undefined ? 0 : o.fade);
            ctx.state_music = { path: what, volume: o.volume === undefined ? 1 : o.volume };
            return sound;
        },

        /** Скорость музыки: 1.0 — как записано, 0.5 — вдвое медленнее и ниже. */
        musicPitch(value) {
            if (value === undefined) return engine.audio.musicPitch();
            engine.audio.setMusicPitch(value);
            return sound;
        },

        crossfade(what, ms) {
            const id = soundId(what);
            if (id < 0) return sound;
            // движок сам гасит старую дорожку и поднимает новую
            engine.audio.music(id, true, 1, ms === undefined ? 800 : ms);
            ctx.state_music = { path: what, volume: 1 };
            return sound;
        },

        stopMusic(ms) { engine.audio.stopMusic(ms === undefined ? 0 : ms); ctx.state_music = null; return sound; },
        pauseMusic(paused) { engine.audio.pauseMusic(!!paused); return sound; },
        musicPlaying() { return engine.audio.musicPlaying(); },

        /** Общая громкость: число (0..1) или `{ db: -6 }`. */
        volume(value) {
            if (value === undefined) return engine.audio.getMasterVolume();
            const v = levelValue(value);
            if (v !== undefined) engine.audio.setMasterVolume(v);
            return sound;
        },
        sfxVolume(value) {
            const v = levelValue(value);
            if (v !== undefined) engine.audio.setSfxVolume(v);
            return sound;
        },
        musicVolume(value) {
            const v = levelValue(value);
            if (v !== undefined) engine.audio.setMusicVolume(v);
            return sound;
        },

        /** Перевод громкости: `$.sound.dbToLinear(-6)` → 0.501. */
        dbToLinear(db) { return dbToLinear(db); },
        linearToDb(value) { return linearToDb(value); },

        mute(flag) {
            if (flag === undefined) return sound._muted || false;
            const on = !!flag;
            // Перед первым приглушением запоминаем текущую громкость: без этого
            // mute(false) всегда возвращал ровно 1.0 и стирал выставленный
            // игроком уровень (например, $.sound.volume(0.4)).
            if (on && !sound._muted) sound._saved_volume = engine.audio.getMasterVolume();
            sound._muted = on;
            engine.audio.setMasterVolume(on ? 0 : (sound._saved_volume === undefined ? 1 : sound._saved_volume));
            return sound;
        },

        stopAll(fadeMs) {
            engine.audio.stopAll(fadeMs === undefined ? 0 : fadeMs);
            noteAudio({ action: 'stopAll', fade: fadeMs === undefined ? 0 : fadeMs });
            return sound;
        },
        stop(channel, fadeMs) {
            engine.audio.stop(channel, fadeMs === undefined ? 0 : fadeMs);
            noteAudio({ action: 'stop', channel, fade: fadeMs === undefined ? 0 : fadeMs });
            return sound;
        },
        playing(channel) { return engine.audio.playing(channel); },

        /**
         * Состояние канала эффектов: `$.sound.channel(ch)` →
         * `{ playing, volume, pan, pitch, effect, position, duration }` —
         * то, что сейчас звучит, а не то, что игра когда-то задала.
         */
        channel(channel) {
            const a = engine.audio;
            const ch = Number(channel) | 0;
            const num = (fn, def) => (typeof a[fn] === 'function' ? a[fn](ch) : def);
            return {
                playing: !!num('playing', false),
                volume: num('channelVolume', 0),
                pan: num('channelPan', 0),
                pitch: num('channelPitch', 1),
                effect: num('channelEffect', 'none'),
                position: num('position', -1),
                duration: num('channelDuration', -1),
            };
        },

        /**
         * Перемотать проигрываемый звук: `$.sound.seek(channel, seconds)`.
         *
         * Возвращает `false`, если канал не играет или перемотка не удалась.
         */
        seek(channel, seconds) {
            if (typeof engine.audio.seek !== 'function') return false;
            return !!engine.audio.seek(channel, seconds === undefined ? 0 : seconds);
        },

        /** Позиция канала в секундах (-1, если не играет). */
        position(channel) {
            if (typeof engine.audio.position !== 'function') return -1;
            return engine.audio.position(channel);
        },

        /** Длительность звука на канале в секундах (-1, если неизвестна). */
        durationOf(channel) {
            if (typeof engine.audio.channelDuration !== 'function') return -1;
            return engine.audio.channelDuration(channel);
        },

        /** С каким приоритетом запущен канал (-1, если не играет). */
        priorityOf(channel) {
            if (typeof engine.audio.channelPriority !== 'function') return -1;
            return engine.audio.channelPriority(channel);
        },

        /**
         * Сколько каналов занято: `$.sound.busy()`.
         *
         * `active` — сколько каналов играет прямо сейчас
         * (`engine.audio.activeChannels()`), `free` — сколько осталось,
         * `total` — фактический предел движка (см. `$.sound.channels()`).
         *
         * Предел — не «деталь реализации»: при полном пуле движок вытесняет
         * САМЫЙ НЕВАЖНЫЙ звук по `priority`, а если вытеснять некого,
         * `play()` возвращает `-1`. В плотной сцене это штатный путь, поэтому
         * смотреть `active`/`free` и ставить `priority` — обязательный приём,
         * а не редкость (docs/highlevel/sound.md, docs/highlevel/audiobus.md).
         */
        busy() {
            const active = typeof engine.audio.activeChannels === 'function'
                ? engine.audio.activeChannels() : 0;
            const total = typeof engine.audio.channelCount === 'function'
                ? engine.audio.channelCount() : 0;
            return { active, free: Math.max(0, total - active), total };
        },

        /**
         * Фактический предел эффект-каналов движка: `$.sound.channels()`.
         *
         * Число берётся у движка, а не из зашитой константы: было 16, стало 128
         * (замеры цены — в `src/audio.h`). Сеттера нет намеренно: ёмкость пула —
         * compile-time потолок (массивы каналов и треки SDL_mixer создаются на
         * старте), а «мягкий» лимит в JS был бы вторым источником правды —
         * игра отказывала бы себе в звуках, тогда как движок их принимает.
         * Нужен меньший пул — управляйте приоритетами и смотрите `busy()`.
         */
        channels() {
            return typeof engine.audio.channelCount === 'function'
                ? engine.audio.channelCount() : 0;
        },
        activeChannels() { return engine.audio.activeChannels(); },
        duration(what) { return engine.audio.duration(soundId(what)); },
        count() { return engine.audio.count(); },

        /**
         * Музыкальные слои: `$.sound.stems(['calm.ogg', 'battle.ogg'], opts)`
         * → transport, у которого старт/seek/pause общие для всех слоёв.
         *
         * opts: `{ loop = true, loopStart = 0, loopEnd = 0, bus = 'music' }`
         * (`loopStart`/`loopEnd` — секунды; `loopEnd = 0` — конец файла).
         * Слои нумеруются в порядке путей; `transport.gains({ 'battle.ogg': 1 })`
         * принимает пути, `layer(i, gain)` и `crossfade(i, ms)` — индексы.
         */
        stems(paths, opts) { return makeStemTransport(paths, opts); },

        /** Живые транспорты слоёв — для отладки и уборки. */
        musicLayers() { return stem_transports.slice(); },

        /** Предзагрузка: путь → id в кэше. */
        preload(paths) {
            for (const p of [].concat(paths)) soundId(p);
            return sound;
        },
    };

    ctx.sound = sound;
    return sound;
}

/** Точка прослушивания: слушатель $.audio, иначе центр камеры. */
function listenerPoint() {
    if (ctx.audio && typeof ctx.audio.listener === 'function') {
        const p = ctx.audio.listener();
        if (p && typeof p.x === 'number') return p;
    }
    return ctx.camera ? ctx.camera.pos() : { x: 0, y: 0 };
}

/**
 * Промах цели — ОДИН раз на пару «место + цель» (правило task-46…49): ключ —
 * СЫРАЯ цель, после успешного разрешения серия начинается заново.
 */
const sound_missed = new Set();

function missSound(where, what, message) {
    const key = where + ' ' + what;
    if (sound_missed.has(key)) return;
    sound_missed.add(key);
    ctx.log(`$.sound.${where}: ${message}`);
}

function soundResolved(where, what) { sound_missed.delete(where + ' ' + what); }

function toPoint(where, method) {
    if (typeof where === 'string') {
        const node = query(where)[0];
        if (node) {
            if (method) soundResolved(method, where);
            return { x: node.x, y: node.y };
        }
        if (method) {
            missSound(method, where,
                      `селектор "${where}" ни к чему не подошёл — беру точку (0, 0)`);
        }
        return { x: 0, y: 0 };
    }
    if (typeof where === 'object' && where && where.nodes) {
        const node = where.nodes[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (typeof where === 'object' && where && where.tag) return { x: where.x, y: where.y };
    if (Array.isArray(where)) return { x: where[0], y: where[1] };
    return { x: 0, y: 0 };
}
