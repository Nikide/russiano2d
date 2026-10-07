// ===========================================================================
// Звук: $.sound — эффекты, позиционное звучание, музыка.
//
// Позиционность приблизительная: SDL_mixer умеет панораму (pan -1..1) и
// громкость, поэтому «где звучит» вычисляется относительно камеры. Этого
// достаточно для 2D: источник слева — в левом ухе.
// ===========================================================================

import { ctx, query } from './core.js';

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
            return channel;
        },

        /** Звук в точке мира: панорама по X относительно камеры, тише по Z. */
        playAt(what, where, opts) {
            const o = Object.assign({ max: 700 }, opts);
            const pos = toPoint(where);
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

        /** Общая громкость 0..1. */
        volume(value) {
            if (value === undefined) return engine.audio.getMasterVolume();
            engine.audio.setMasterVolume(value);
            return sound;
        },
        sfxVolume(value) { engine.audio.setSfxVolume(value); return sound; },
        musicVolume(value) { engine.audio.setMusicVolume(value); return sound; },

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

        stopAll(fadeMs) { engine.audio.stopAll(fadeMs === undefined ? 0 : fadeMs); return sound; },
        stop(channel, fadeMs) { engine.audio.stop(channel, fadeMs === undefined ? 0 : fadeMs); return sound; },
        playing(channel) { return engine.audio.playing(channel); },

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
         * `active` — общее число играющих каналов из `engine.audio.activeChannels()`,
         * `free` — сколько осталось (лимит движка, обычно 16 эффект-каналов).
         */
        busy() {
            const active = typeof engine.audio.activeChannels === 'function'
                ? engine.audio.activeChannels() : 0;
            const total = typeof engine.audio.channelCount === 'function'
                ? engine.audio.channelCount() : 16;
            return { active, free: Math.max(0, total - active), total };
        },
        activeChannels() { return engine.audio.activeChannels(); },
        duration(what) { return engine.audio.duration(soundId(what)); },
        count() { return engine.audio.count(); },

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

function toPoint(where) {
    if (typeof where === 'string') {
        const node = query(where)[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (typeof where === 'object' && where && where.nodes) {
        const node = where.nodes[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (typeof where === 'object' && where && where.tag) return { x: where.x, y: where.y };
    if (Array.isArray(where)) return { x: where[0], y: where[1] };
    return { x: 0, y: 0 };
}
