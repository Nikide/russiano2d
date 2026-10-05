// ===========================================================================
// Звук: $.sound — эффекты, позиционное звучание, музыка.
//
// Позиционность приблизительная: SDL_mixer умеет панораму (pan -1..1) и
// громкость, поэтому «где звучит» вычисляется относительно камеры. Этого
// достаточно для 2D: источник слева — в левом ухе.
// ===========================================================================

import { ctx, query } from './core.js';

const loaded = new Map();     // путь → id звука
let warned_pitch = false;

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
        /** play('hit.wav', { volume, pan, loop }) → id канала или -1. */
        play(what, opts) {
            const o = opts || {};
            if (o.pitch !== undefined && !warned_pitch) {
                warned_pitch = true;
                ctx.log('$: $.sound.play({pitch}) не поддерживается SDL_mixer — параметр игнорируется');
            }
            const id = soundId(what);
            if (id < 0) return -1;
            return engine.audio.play(id, o.volume === undefined ? 1 : o.volume,
                                     o.pan === undefined ? 0 : o.pan,
                                     o.loop ? 1 : 0);
        },

        /** Звук в точке мира: панорама по X относительно камеры, тише по Z. */
        playAt(what, where, opts) {
            const o = Object.assign({ max: 700 }, opts);
            const pos = toPoint(where);
            const cam = ctx.camera ? ctx.camera.pos() : { x: 0, y: 0 };
            const dx = pos.x - cam.x;
            const dy = pos.y - cam.y;
            const dist = Math.hypot(dx, dy);
            if (dist > o.max) return -1;
            const pan = Math.max(-1, Math.min(1, dx / (o.max * 0.5)));
            const volume = (o.volume === undefined ? 1 : o.volume) * (1 - dist / o.max);
            return sound.play(what, Object.assign({}, o, { pan, volume: Math.max(0, volume), loop: o.loop }));
        },

        /** Музыка. crossfadeMs — плавно заменить текущую дорожку. */
        music(what, opts) {
            const o = opts || {};
            const id = soundId(what);
            if (id < 0) return sound;
            engine.audio.music(id, o.loop !== false, o.volume === undefined ? 1 : o.volume,
                               o.fade === undefined ? 0 : o.fade);
            ctx.state_music = { path: what, volume: o.volume === undefined ? 1 : o.volume };
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
