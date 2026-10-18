// ===========================================================================
// polish.js — P2-полировка городской сцены на существующих подсистемах.
//
// Здесь только СЭМПЛЫ-хелперы, а не новые движковые подсистемы:
//   * decals — пул следов шин/ударов поверх готового decal-провайдера
//     (Re2D: world.decal(surface, material, u, v, width, height, life[,
//     rotation, scale, fadeIn, fadeOut]); обычный 2D: свой провайдер/2D-пул);
//   * vfx — привязанные эмиттеры (`<particles>`) и разовые залпы;
//   * audio — позиционные хелперы (двигатель/гудок/сирена/визг) через
//     `$.audio.play` handle (volume/pan) или `$.sound.playAt`;
//   * camera — top-down preset поверх `$.camera.follow/zoom/shake/limits`;
//   * debug — переключаемые оверлеи тегов/полос/колец спавна через
//     `$.debug.draw` (мировые координаты, учитывает камеру);
//   * profile()/measure() — заметки и замеры через `$.debug.profiler`.
//
// Ограничение (честно): в Re2D НЕТ API альфа-затухания поверхности, поэтому
// roof fade не поддерживается — см. roofFadeAudit(). `.sky(true)` скрывает
// потолок, но это не fade, и подделывать его здесь нельзя.
// ===========================================================================

const DEFAULT_DECAL_LIFE = 12;      // секунд, как у world.decal
const DEFAULT_DECAL_MAX = 96;
const DEFAULT_TAG_SAMPLE = 64;      // шаг сетки семплирования тегов, px

function pointOf(value) {
    if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0 };
    if (value && typeof value === 'object') return { x: Number(value.x) || 0, y: Number(value.y) || 0 };
    return { x: 0, y: 0 };
}

function nodeOf(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    if (value.nodes && Array.isArray(value.nodes)) return value.nodes[0] || null;
    return value;
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// ---------------------------------------------------------------------------
// 1. Decal pool
// ---------------------------------------------------------------------------

/**
 * Пул decals с лимитом и fade.
 *
 * `provider` — ИНТЕРФЕЙС, который даёт сцена (мы не лезем в нативные детали):
 *   • функция `(spec) => handle | null`, либо
 *   • объект `{ decal(spec) => handle }`.
 * `handle` — что угодно с `.remove()` (как у `world.decal`) или null.
 * `spec`: `{ x, y, surface, material, u, v, width, height, life, rotation,
 *           scale, fadeIn, fadeOut, kind }`. Для Re2D x/y нужны только
 * логике; поверхность/UV либо кладёт провайдер, либо игра передаёт сама.
 *
 * Готовый адаптер Re2D: `re2dDecalProvider(world)` — он ожидает в spec
 * `surface/material/u/v` (world.decal ставит decal на поверхность, а не по
 * мировой точке).
 */
export function createDecalPool($, options = {}) {
    const opts = options || {};
    const max = Math.max(1, Math.trunc(Number(opts.max ?? DEFAULT_DECAL_MAX) || DEFAULT_DECAL_MAX));
    const defaultLife = Number(opts.life ?? DEFAULT_DECAL_LIFE);
    const defaultWidth = Number(opts.width ?? 10);
    const defaultHeight = Number(opts.height ?? 10);
    const provider = opts.provider || null;
    let seq = 0;
    let entries = [];
    const stats = { placed: 0, recycled: 0, expired: 0, removed: 0, unsupported: 0 };

    function providerCall(spec) {
        if (!provider) { stats.unsupported++; return null; }
        try {
            if (typeof provider === 'function') return provider(spec);
            if (typeof provider.decal === 'function') return provider.decal(spec);
            if (typeof provider.place === 'function') return provider.place(spec);
        } catch (e) {
            stats.unsupported++;
            return null;
        }
        stats.unsupported++;
        return null;
    }

    function removeEntry(entry, reason) {
        if (!entry || entry.dead) return false;
        entry.dead = true;
        if (entry.handle && typeof entry.handle.remove === 'function') {
            try { entry.handle.remove(); } catch (e) { /* уже снят */ }
        }
        if (reason === 'expired') stats.expired++;
        else if (reason === 'recycled') stats.recycled++;
        else stats.removed++;
        return true;
    }

    function place(spec = {}) {
        const p = pointOf(spec);
        const life = spec.life === undefined ? defaultLife : Number(spec.life);
        const entry = {
            seq: seq++,
            x: p.x, y: p.y,
            kind: spec.kind || 'decal',
            life: Number.isFinite(life) ? Math.max(0, life) : defaultLife,
            age: 0,
            spec: {
                ...spec, x: p.x, y: p.y,
                width: Number(spec.width ?? defaultWidth) || defaultWidth,
                height: Number(spec.height ?? defaultHeight) || defaultHeight,
                life: Number.isFinite(life) ? Math.max(0, life) : defaultLife,
                rotation: Number(spec.rotation) || 0,
                scale: Number(spec.scale ?? 1) || 1,
                fadeIn: Number(spec.fadeIn ?? opts.fadeIn ?? 0) || 0,
                fadeOut: Number(spec.fadeOut ?? opts.fadeOut ?? 0) || 0,
                material: spec.material === undefined ? (opts.material ?? 0) : spec.material,
            },
            handle: null,
        };
        if (entries.length >= max) {
            const oldest = entries.filter((e) => !e.dead).sort((a, b) => a.seq - b.seq)[0];
            if (oldest) removeEntry(oldest, 'recycled');
        }
        entry.handle = providerCall(entry.spec);
        if (!entry.handle) return null;
        entries.push(entry);
        stats.placed++;
        return { seq: entry.seq, kind: entry.kind, life: entry.life, remove: () => removeEntry(entry, 'removed') };
    }

    return {
        /** След шины: размер по умолчанию шире следа удара. */
        tyre(x, y, spec = {}) {
            return place({ ...spec, x, y, kind: 'tyre', width: spec.width ?? 14, height: spec.height ?? 6,
                           life: spec.life ?? Math.min(defaultLife, 8), rotation: spec.rotation ?? spec.angle ?? 0 });
        },
        /** След удара/скол. */
        impact(x, y, spec = {}) {
            return place({ ...spec, x, y, kind: 'impact', width: spec.width ?? 8, height: spec.height ?? 8,
                           life: spec.life ?? defaultLife });
        },
        /** Произвольный decal (surface/u/v прокидываются как есть). */
        place,

        update(dt) {
            const step = Number(dt);
            if (!Number.isFinite(step) || step < 0) throw new RangeError('polish.decals.update: dt >= 0');
            let removed = 0;
            const keep = [];
            for (const entry of entries) {
                if (entry.dead) continue;
                entry.age += step;
                if (entry.life > 0 && entry.age >= entry.life) { removeEntry(entry, 'expired'); removed++; continue; }
                keep.push(entry);
            }
            entries = keep;
            return removed;
        },
        count() { return entries.filter((e) => !e.dead).length; },
        clear() {
            let n = 0;
            for (const entry of entries.slice()) if (removeEntry(entry, 'removed')) n++;
            entries = [];
            return n;
        },
        stats() {
            return { ...stats, active: entries.filter((e) => !e.dead).length, max,
                     provider: !!provider, supported: !!provider };
        },
    };
}

/** Адаптер Re2D: `world.decal({surface,material,u,v,width,height,life,…})`. */
export function re2dDecalProvider(world) {
    if (!world || typeof world.decal !== 'function') {
        throw new TypeError('re2dDecalProvider: нужен Re2D world с .decal');
    }
    return spec => world.decal({
        surface: spec.surface,
        material: spec.material ?? 0,
        u: spec.u ?? 0,
        v: spec.v ?? 0,
        width: spec.width ?? 10,
        height: spec.height ?? 10,
        life: spec.life ?? DEFAULT_DECAL_LIFE,
        rotation: spec.rotation ?? 0,
        scale: spec.scale ?? 1,
        fadeIn: spec.fadeIn ?? 0,
        fadeOut: spec.fadeOut ?? 0,
    });
}

// ---------------------------------------------------------------------------
// 2. VFX emitters (attached / burst) — существующие частицы и $.vfx
// ---------------------------------------------------------------------------

/**
 * `exhaust(node, {preset, dx, dy, ...params})` — дым/огонь, ПРИВЯЗАННЫЙ к узлу:
 * дочерний `<particles>` в локальном пространстве, поэтому он едет с машиной.
 * Возвращает `{ emitter, start, stop, remove, params }`.
 */
export function createVfxAttach($, options = {}) {
    const opts = options || {};
    const active = [];
    const stats = { attached: 0, bursts: 0, removed: 0, unsupported: 0 };

    function preset(name, overrides) {
        if ($.particles && typeof $.particles.preset === 'function') return $.particles.preset(name, overrides);
        return { ...(overrides || {}) };   // без пресетов — чистые параметры
    }

    function track(handle) { active.push(handle); return handle; }

    function attach(nodeValue, spec = {}) {
        const parent = $(nodeValue);
        if (!parent || !parent.length) { stats.unsupported++; return null; }
        const p = {
            amount: spec.amount ?? 10,
            lifetime: spec.lifetime ?? [220, 420],
            speed: spec.speed ?? [10, 30],
            direction: spec.direction ?? -90,
            spread: spec.spread ?? 30,
            size: spec.size ?? [5, 10],
            end_size: spec.end_size ?? 2,
            alpha_ramp: spec.alpha_ramp ?? [{ t: 0, alpha: 0.55 }, { t: 1, alpha: 0 }],
            color: spec.color ?? '#b9b9b9',
            emitting: spec.emitting !== false,
            seed: spec.seed ?? 7,
            local: true,
        };
        const params = spec.preset ? preset(spec.preset, { ...p, ...(spec.params || {}) }) : { ...p, ...(spec.params || {}) };
        let emitter;
        try {
            emitter = $('<particles>', params).appendTo(parent);
        } catch (e) {
            stats.unsupported++;
            return null;
        }
        if (typeof emitter.transformSpace === 'function') emitter.transformSpace('local');
        if (typeof emitter.localAt === 'function') emitter.localAt(Number(spec.dx ?? 0), Number(spec.dy ?? 0));
        else emitter.at((Number(nodeOf(parent)?.x) || 0) + Number(spec.dx ?? 0),
                        (Number(nodeOf(parent)?.y) || 0) + Number(spec.dy ?? 0));
        if (typeof emitter.params === 'function' && spec.params) emitter.params(spec.params);
        stats.attached++;
        const handle = {
            emitter,
            start() { if (typeof emitter.start === 'function') emitter.start(); return handle; },
            stop() { if (typeof emitter.stop === 'function') emitter.stop(); return handle; },
            params(patch) { if (typeof emitter.params === 'function') emitter.params(patch); return handle; },
            remove() {
                const i = active.indexOf(handle);
                if (i >= 0) active.splice(i, 1);
                try { if (typeof emitter.remove === 'function') emitter.remove(); } catch (e) { /* уже удалён */ }
                stats.removed++;
            },
        };
        return track(handle);
    }

    function burst(name, at, spec = {}) {
        const point = pointOf(at);
        // Если есть $.vfx — используем готовый эффект (уже с бюджетом/seed).
        if (spec.useVfx && $.vfx && typeof $.vfx.play === 'function' && typeof name === 'string'
            && $.vfx.list && $.vfx.list().indexOf(name) >= 0) {
            try {
                const h = $.vfx.play(name, { at: [point.x, point.y] });
                stats.bursts++;
                return { vfx: h, remove: () => { if (h && typeof h.stop === 'function') h.stop(); } };
            } catch (e) { /* падать из-за эффекта сцена не должна */ }
        }
        const p = preset(spec.preset || 'sparks', {
            amount: spec.amount ?? 14,
            lifetime: spec.lifetime ?? [180, 380],
            global: true,
            one_shot: true,
            emitting: false,
            seed: spec.seed ?? 1,
            ...(spec.params || {}),
        });
        let emitter;
        try {
            emitter = $('<particles>', p).at(point.x, point.y).appendTo($.world);
        } catch (e) {
            stats.unsupported++;
            return null;
        }
        stats.bursts++;
        const handle = {
            emitter,
            remove() {
                const i = active.indexOf(handle);
                if (i >= 0) active.splice(i, 1);
                try { if (typeof emitter.remove === 'function') emitter.remove(); } catch (e) { /* уже */ }
                stats.removed++;
            },
        };
        if (spec.autoRemove !== false) {
            try { emitter.on('particlesEnd', () => handle.remove()); } catch (e) { /* событие не обязательно */ }
        }
        return track(handle);
    }

    return {
        attach,
        exhaust: (node, spec = {}) => attach(node, { preset: spec.preset || 'smoke', ...spec }),
        fire: (node, spec = {}) => attach(node, { preset: 'fire', ...spec }),
        burst,
        /** Разовый удар: искры в точке. */
        impact(x, y, spec = {}) { return burst(spec.name || 'sparks', { x, y }, spec); },
        update(dt) {
            // Частицы тикает движок ($.particles); здесь только уборка
            // «осиротевших» привязанных эмиттеров, если родитель умер.
            for (const handle of active.slice()) {
                const n = handle.emitter && nodeOf(handle.emitter);
                if (!n || n.removed) handle.remove();
            }
            return active.length;
        },
        count() { return active.length; },
        clear() { for (const h of active.slice()) h.remove(); return 0; },
        stats() { return { ...stats, active: active.length }; },
    };
}

// ---------------------------------------------------------------------------
// 3. Spatial audio helpers (двигатель / гудок / сирена / визг)
// ---------------------------------------------------------------------------

/**
 * Позиционные хелперы через существующий звук.
 *
 * `spatial(file, {source, loop, volume, pan, priority, maxDistance})`:
 *   • `$.audio.play(file, {loop, volume:0})` даёт handle с volume()/pan() —
 *     поэтому громкость/панораму можно вести каждый кадр;
 *   • без `$.audio` — `$.sound.playAt` (позиция считается один раз).
 *
 * `engine(node, opts)`: псевдо-непрерывный pitch. В публичном API нет
 * setChannelPitch, поэтому тон задаётся при (пере)запуске: шаг «перезапуск»
 * делается только при заметной смене скорости и не чаще `pitchRebuild` сек.
 * Это документированное ограничение, а не выдуманный эффект.
 */
export function createSpatialAudio($, options = {}) {
    const opts = options || {};
    const audio = $.audio && typeof $.audio.play === 'function' ? $.audio : null;
    const sound = $.sound && typeof $.sound.play === 'function' ? $.sound : null;
    const camera = $.camera && typeof $.camera.pos === 'function' ? $.camera : null;
    const handles = [];
    let seq = 0;
    const stats = { started: 0, restarts: 0, stopped: 0, unsupported: 0 };
    const available = !!(audio || sound);

    function listener() {
        if (opts.listener) return pointOf(opts.listener);
        if (camera) { try { return camera.pos(); } catch (e) { /* нет камеры */ } }
        return { x: 0, y: 0 };
    }

    function spatialVolume(point, base, maxDistance) {
        const l = listener();
        const d = Math.hypot(point.x - l.x, point.y - l.y);
        const gain = maxDistance > 0 ? clamp01(1 - d / maxDistance) : 1;
        const pan = maxDistance > 0 ? Math.max(-1, Math.min(1, (point.x - l.x) / (maxDistance * 0.5))) : 0;
        return { gain: clamp01(base * gain), pan, distance: d };
    }

    function startChannel(file, spec) {
        if (!file) { stats.unsupported++; return null; }
        if (audio) {
            try {
                const h = audio.play(file, { loop: spec.loop === true, volume: 0, priority: spec.priority ?? 4,
                                            keep: spec.keep === true, pitch: spec.pitch ?? 1 });
                if (!h) { stats.unsupported++; return null; }
                stats.started++;
                return h;
            } catch (e) { /* падать из-за звука нельзя */ }
        }
        if (sound) {
            try {
                const point = pointOf(spec.source);
                if (typeof sound.playAt === 'function') {
                    const ch = sound.playAt(file, point.x, point.y, { loop: spec.loop === true, volume: spec.volume ?? 1,
                                                                     priority: spec.priority ?? 4 });
                    stats.started++;
                    return { channel: ch, stop: (fade) => sound.stop(ch, fade || 0), volume() { return this; }, pan() { return this; } };
                }
            } catch (e) { /* нет звука */ }
        }
        stats.unsupported++;
        return null;
    }

    function makeHandle(file, spec) {
        const state = {
            file, source: spec.source || null, loop: spec.loop === true,
            volume: spec.volume === undefined ? 1 : Number(spec.volume),
            maxDistance: Number(spec.maxDistance ?? spec.radius ?? 900),
            pitch: Number(spec.pitch ?? 1),
            priority: spec.priority ?? 4,
            pitchRebuild: Number(spec.pitchRebuild ?? 0.35),
            rebuildTimer: 0,
            basePitch: Number(spec.basePitch ?? 1),
            maxPitch: Number(spec.maxPitch ?? 2.2),
            channel: null,
            stopped: false,
        };
        const handle = {
            id: ++seq,
            state,
            file,
            /** Перезапуск канала (единственный публичный способ сменить pitch). */
            restart(pitch) {
                if (state.stopped) return handle;
                const p = pitch === undefined ? state.pitch : Math.max(0.1, Number(pitch));
                if (state.channel && typeof state.channel.stop === 'function') state.channel.stop(40);
                state.pitch = p;
                state.channel = startChannel(file, { ...spec, loop: state.loop, pitch: p, priority: state.priority });
                stats.restarts++;
                return handle;
            },
            update(dt, pointOverride) {
                if (state.stopped || !state.channel) return handle;
                const point = pointOverride ? pointOf(pointOverride) : pointOf(state.source || { x: 0, y: 0 });
                const mix = spatialVolume(point, state.volume, state.maxDistance);
                if (typeof state.channel.volume === 'function') state.channel.volume(mix.gain);
                if (typeof state.channel.pan === 'function') state.channel.pan(mix.pan);
                return handle;
            },
            volume(v) { state.volume = clamp01(Number(v)); return handle; },
            pan(p) { state.pan = Number(p) || 0; return handle; },
            source(v) { state.source = v; return handle; },
            isPlaying() { return !!(state.channel && typeof state.channel.playing === 'function' && state.channel.playing()); },
            stop(fade = 0) {
                if (state.stopped) return handle;
                state.stopped = true;
                if (state.channel && typeof state.channel.stop === 'function') state.channel.stop(fade);
                stats.stopped++;
                return handle;
            },
        };
        state.channel = startChannel(file, { ...spec, loop: state.loop, pitch: state.pitch, priority: state.priority });
        if (!state.channel) return null;
        // Стартовая громкость — сразу, чтобы не было щелчка в полной громкости.
        handle.update(0);
        handles.push(handle);
        return handle;
    }

    return {
        available,
        spatial: (file, spec = {}) => makeHandle(file, spec),
        horn(file, spec = {}) {
            const h = makeHandle(file, { ...spec, loop: false, priority: spec.priority ?? 6 });
            if (h) h.update(0, spec.source);
            return h;
        },
        skid(file, spec = {}) {
            const h = makeHandle(file, { ...spec, loop: true, volume: spec.volume ?? 0.5 });
            return {
                handle: h,
                set(on) {
                    if (!h) return;
                    if (on && !h.isPlaying()) h.restart();
                    if (!on) h.stop(60);
                },
                stop() { if (h) h.stop(80); },
            };
        },
        siren(file, spec = {}) {
            const twoTone = spec.twoTone !== false;
            const period = Number(spec.period ?? 0.7);
            const h = makeHandle(file, { ...spec, loop: true, pitch: spec.lowPitch ?? 0.85 });
            if (!h) return null;
            let phase = 0;
            return {
                handle: h,
                update(dt, point) {
                    h.update(dt, point);
                    if (!twoTone || !h.isPlaying()) return;
                    phase += dt;
                    if (phase >= period) {
                        phase = 0;
                        const high = h.state.pitch > 1.1 ? false : true;
                        h.restart(high ? (spec.highPitch ?? 1.35) : (spec.lowPitch ?? 0.85));
                    }
                },
                stop() { h.stop(120); },
            };
        },
        /**
         * Двигатель: тон при старте от скорости; при изменении скорости
         * заметно (шаг 0.08) и не чаще pitchRebuild — перезапуск канала.
         * `speed` — функция () => px/s или число.
         */
        engine(nodeValue, spec = {}) {
            const source = nodeValue || spec.source;
            const speedFn = typeof spec.speed === 'function' ? spec.speed : () => Number(spec.speed || 0);
            const h = makeHandle(spec.file, { ...spec, source, loop: true,
                volume: spec.idleVolume === undefined ? 0.25 : Number(spec.idleVolume),
                pitch: Number(spec.basePitch ?? 0.85), priority: spec.priority ?? 3 });
            if (!h) return null;
            let speedRef = Number(spec.speedRef ?? 220);
            let lastPitch = Number(spec.basePitch ?? 0.85);
            h.state.pitchRebuild = Number(spec.pitchRebuild ?? 0.35);
            return {
                handle: h,
                update(dt, point) {
                    h.rebuildTimer = Math.min(60, h.rebuildTimer + dt);
                    const sp = Math.max(0, Number(speedFn()) || 0);
                    const target = Math.min(Number(spec.maxPitch ?? 2.2),
                        Number(spec.basePitch ?? 0.85) + (sp / Math.max(1, speedRef)) * (1 - Number(spec.basePitch ?? 0.85)));
                    h.state.volume = clamp01(Number(spec.idleVolume ?? 0.25) + clamp01(sp / speedRef) * (1 - Number(spec.idleVolume ?? 0.25)));
                    h.update(dt, point || source);
                    if (Math.abs(target - lastPitch) > 0.08 && h.rebuildTimer >= h.state.pitchRebuild) {
                        lastPitch = target;
                        h.rebuildTimer = 0;
                        h.restart(target);
                    }
                    return target;
                },
                state() { return { pitch: h.state.pitch, target: lastPitch, channel: h.state.channel && h.state.channel.channel }; },
                stop() { h.stop(80); },
            };
        },
        update(dt) {
            const list = handles.splice(0, handles.length);
            const keep = [];
            for (const h of list) {
                if (h.state.stopped) continue;
                if (typeof h.state.source === 'object' && h.state.source) h.update(dt);
                keep.push(h);
            }
            for (const h of keep) handles.push(h);
            return keep.length;
        },
        count() { return handles.filter((h) => !h.state.stopped).length; },
        stopAll(fade = 0) { for (const h of handles.slice()) h.stop(fade); handles.length = 0; },
        stats() { return { ...stats, active: handles.filter((h) => !h.state.stopped).length, available, backend: audio ? 'audio' : (sound ? 'sound' : 'none') }; },
    };
}

// ---------------------------------------------------------------------------
// 4. Top-down camera preset
// ---------------------------------------------------------------------------

/**
 * Top-down preset поверх `$.camera`: follow + zoom + look-ahead + deadzone +
 * limits + shake. Отдельной «камерной подсистемы» нет.
 *
 *   const cam = createTopDownCamera($, { follow: '#hero', zoom: 1.2,
 *                                       bounds: { x: 0, y: 0, w: 3000, h: 2000 },
 *                                       lookahead: 80, shake: 4 });
 *   cam.apply();
 *   cam.shake(8, 220);
 */
export function createTopDownCamera($, options = {}) {
    const opts = options || {};
    const cam = $.camera;
    if (!cam || typeof cam.follow !== 'function') throw new Error('polish.camera: нужен $.camera');
    const config = {
        follow: opts.follow || null,
        zoom: Number(opts.zoom ?? 1),
        smooth: Number(opts.smooth ?? 0.14),
        deadzone: opts.deadzone || null,
        lookahead: Number(opts.lookahead ?? 0),
        lookaheadSmooth: Number(opts.lookaheadSmooth ?? 0.9),
        offset: opts.offset || null,
        bounds: opts.bounds || null,
        shakeAmp: Number(opts.shake ?? 4),
    };
    let saved = null;

    function applyLimits() {
        if (config.bounds) cam.limits(config.bounds.x, config.bounds.y, config.bounds.w, config.bounds.h);
        else cam.limits(null);
    }

    function apply() {
        if (config.follow) {
            cam.follow(config.follow, {
                smooth: config.smooth,
                deadzone: config.deadzone || undefined,
                lookahead: config.lookahead || undefined,
                lookaheadSmooth: config.lookaheadSmooth,
                offset: config.offset || undefined,
            });
        } else {
            cam.unfollow();
        }
        cam.zoom(config.zoom);
        if (config.deadzone && typeof cam.deadzone === 'function') cam.deadzone(config.deadzone);
        if (config.lookahead > 0 && typeof cam.lookahead === 'function') cam.lookahead(config.lookahead, config.lookaheadSmooth);
        applyLimits();
        return preset;
    }

    const preset = {
        config,
        apply,
        save() { saved = typeof cam.snapshot === 'function' ? cam.snapshot() : null; return preset; },
        restore() {
            if (saved && typeof cam.restore === 'function') cam.restore(saved);
            saved = null;
            return preset;
        },
        follow(target) { config.follow = target; return apply(); },
        zoom(value) { config.zoom = Number(value) || 1; cam.zoom(config.zoom); return preset; },
        zoomTo(value, ms) { config.zoom = Number(value) || 1; if (typeof cam.zoomTo === 'function') cam.zoomTo(config.zoom, ms || 0); return preset; },
        bounds(rect) { config.bounds = rect || null; applyLimits(); return preset; },
        shake(amp, ms) {
            const a = amp === undefined ? config.shakeAmp : Number(amp);
            if (typeof cam.shake === 'function') cam.shake(a, ms === undefined ? 200 : ms);
            return preset;
        },
        center() { if (typeof cam.pos === 'function') return cam.pos(); return { x: 0, y: 0 }; },
        info() {
            const info = typeof cam.info === 'function' ? cam.info() : {};
            return { follow: config.follow, zoom: config.zoom, bounds: config.bounds,
                     pos: info.x !== undefined ? { x: info.x, y: info.y } : preset.center() };
        },
        /**
         * Top-down ВИД Re2D (не игровая камера): `world.camera({mode:'topdown'})`.
         * Отдельный вызов, потому что kind камеры движка и вид мира — разные вещи.
         */
        worldView(world, view = {}) {
            if (!world || typeof world.camera !== 'function') throw new TypeError('polish.camera.worldView: нужен Re2D world');
            world.camera({ mode: 'topdown', x: view.x, y: view.y, h: view.h ?? opts.h,
                           yaw: view.yaw, orthoHeight: view.orthoHeight ?? opts.orthoHeight });
            return preset;
        },
    };
    if (opts.apply !== false) apply();
    return preset;
}

// ---------------------------------------------------------------------------
// 5. Debug overlays (существующие $.debug.draw / $.gfx.draw)
// ---------------------------------------------------------------------------

/**
 * Переключаемые оверлеи для разработчика:
 *   lanes    — полосы/направления движения (roadgraph.debugLines());
 *   spawns   — точки спавна + кольца spawn/despawn вокруг AOI;
 *   tags     — семплирование `world.groundAt` по видимой области (Re2D);
 *   stimuli  — последние $.emit('stimulus') (радиусы/затухание).
 *
 * Все координаты — мировые: `$.debug.draw` сам переводит в экран (камера,
 * в том числе Re2D). Это отладочный слой сцены, не часть HUD.
 */
export function createDebugOverlay($, options = {}) {
    const opts = options || {};
    const graph = opts.roadGraph || null;
    const population = opts.population || null;
    const world = opts.world || (graph && graph.world) || null;
    const h = opts.h;
    const sampleStep = Math.max(16, Number(opts.sampleStep ?? DEFAULT_TAG_SAMPLE) || DEFAULT_TAG_SAMPLE);
    const maxLabels = Math.max(0, Number(opts.maxLabels ?? 80));
    const state = { lanes: false, spawns: false, tags: false, stimuli: false };
    const stimuli = [];
    let unsub = null;
    const stats = { drawn: 0, samples: 0, labels: 0, tagError: null };

    if (opts.stimuli !== false && typeof $.on === 'function') {
        const handler = (e) => {
            const d = e && e.data !== undefined ? e.data : e;
            if (!d || typeof d !== 'object') return;
            stimuli.push({ x: Number(d.x) || 0, y: Number(d.y) || 0, radius: Number(d.radius) || 0, type: d.type, age: 0 });
            while (stimuli.length > 24) stimuli.shift();
        };
        $.on('stimulus', handler);
        unsub = () => { if (typeof $.off === 'function') $.off('stimulus', handler); };
    }

    function api() {
        if ($.debug && $.debug.draw && typeof $.debug.draw.line === 'function') return $.debug.draw;
        if ($.gfx && $.gfx.draw) {
            // Резерв: переводим мир→экран сами, рисуем в координатах окна.
            const draw = $.gfx.draw;
            const screen = (p) => {
                try { return $.camera.worldToScreen(p); } catch (e) { return { x: p.x, y: p.y }; }
            };
            return {
                line(a, b, color, width) { const p = screen(pointOf(a)), q = screen(pointOf(b)); draw.line(p.x, p.y, q.x, q.y, color, width); },
                circle(a, r, color) { const p = screen(pointOf(a)); draw.circle(p.x, p.y, r, color); },
                ring(a, r, color, width) { const p = screen(pointOf(a)); draw.ring(p.x, p.y, r, color, width); },
                arrow(a, b, color) { const p = screen(pointOf(a)), q = screen(pointOf(b)); draw.arrow(p.x, p.y, q.x, q.y, color); },
                text(text, a, color, size) { const p = screen(pointOf(a)); draw.text(text, p.x, p.y, color, size); },
                rect(a, b, color) { const p = screen(pointOf(a)), q = screen(pointOf(b)); draw.rect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y), color); },
            };
        }
        return null;
    }

    function viewport() {
        if ($.camera && typeof $.camera.viewport === 'function') {
            try { return $.camera.viewport(); } catch (e) { /* не 2D */ }
        }
        return { x: 0, y: 0, w: 640, h: 360 };
    }

    return {
        state,
        toggle(name, on) {
            const key = String(name);
            if (!(key in state)) throw new RangeError(`polish.debug.toggle: неизвестный слой "${key}" (lanes|spawns|tags|stimuli)`);
            state[key] = on === undefined ? !state[key] : !!on;
            return state[key];
        },
        isOn(name) { return !!state[String(name)]; },
        draw(dt = 0) {
            const d = api();
            if (!d) return null;
            stats.drawn = 0; stats.samples = 0; stats.labels = 0; stats.tagError = null;
            for (const s of stimuli) s.age += Number(dt) || 0;
            while (stimuli.length && stimuli[0].age > 3) stimuli.shift();

            if (state.lanes && graph && typeof graph.debugLines === 'function') {
                for (const line of graph.debugLines()) {
                    const color = line.oneWay ? 'rgba(255,160,90,0.85)' : 'rgba(130,210,255,0.75)';
                    d.line({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, color, 2);
                    const mx = (line.x1 + line.x2) / 2, my = (line.y1 + line.y2) / 2;
                    d.arrow({ x: mx, y: my }, { x: mx + line.dir.x * 14, y: my + line.dir.y * 14 }, color);
                    stats.drawn++;
                }
            }

            if (state.spawns) {
                const focus = population && typeof population.focus === 'function' ? population.focus() : null;
                if (graph && typeof graph.spawnPoints === 'function') {
                    for (const p of graph.spawnPoints({ kind: opts.spawnKind || 'any', world, h })) {
                        d.circle(p, 5, p.kind === 'ped' ? 'rgba(120,255,170,0.8)' : 'rgba(255,220,120,0.8)');
                        stats.drawn++;
                    }
                }
                if (population && typeof population.stats === 'function') {
                    const st = population.stats();
                    if (focus) {
                        d.ring(focus, st.spawnDistance, 'rgba(120,200,255,0.35)', 2);
                        d.ring(focus, st.despawnDistance, 'rgba(255,120,120,0.35)', 2);
                        d.circle(focus, 4, 'rgba(255,255,255,0.9)');
                        stats.drawn += 3;
                    }
                }
                if (population && typeof population.snapshot === 'function') {
                    for (const e of population.snapshot()) {
                        d.circle(e, 4, e.persistent ? 'rgba(255,230,90,0.9)' : 'rgba(180,180,255,0.8)');
                        stats.drawn++;
                        if (e.persistent) {
                            d.ring(e, 9, 'rgba(255,230,90,0.7)', 1);
                            stats.drawn++;
                        }
                    }
                }
            }

            if (state.stimuli) {
                for (const s of stimuli) {
                    const fade = clamp01(1 - s.age / 3);
                    d.circle(s, Math.max(3, s.radius * 0.2), `rgba(255,90,90,${0.35 * fade})`);
                    d.ring(s, 4, `rgba(255,120,120,${0.9 * fade})`, 2);
                    d.text(String(s.type || '?'), s, `rgba(255,200,200,${fade})`, 12);
                    stats.drawn += 3;
                }
            }

            if (state.tags) {
                if (!world || typeof world.groundAt !== 'function') {
                    stats.tagError = 'world.groundAt недоступен (обычный 2D или теги не собраны)';
                } else {
                    const vp = viewport();
                    const colors = {
                        road: 'rgba(150,150,150,0.9)', sidewalk: 'rgba(255,220,120,0.9)',
                        grass: 'rgba(110,220,120,0.9)', water: 'rgba(90,160,255,0.9)',
                        parking: 'rgba(200,160,255,0.9)', no_spawn: 'rgba(255,90,90,0.9)',
                        crosswalk: 'rgba(255,255,255,0.9)', default: 'rgba(120,220,220,0.9)',
                    };
                    outer:
                    for (let y = vp.y + sampleStep / 2; y < vp.y + vp.h; y += sampleStep) {
                        for (let x = vp.x + sampleStep / 2; x < vp.x + vp.w; x += sampleStep) {
                            stats.samples++;
                            let ground = null;
                            try { ground = world.groundAt(x, y, h === undefined ? {} : { h }); }
                            catch (e) { stats.tagError = e && e.message ? e.message : String(e); break outer; }
                            if (!ground || !Array.isArray(ground.tags) || !ground.tags.length) continue;
                            const tags = ground.tags;
                            let key = 'default';
                            for (const name of ['no_spawn', 'road', 'sidewalk', 'crosswalk', 'parking', 'grass', 'water']) {
                                if (tags.indexOf(name) >= 0) { key = name; break; }
                            }
                            d.circle({ x, y }, 2, colors[key] || colors.default);
                            stats.drawn++;
                            if (stats.labels < maxLabels) {
                                d.text(tags.join(','), { x, y: y - 6 }, colors[key] || colors.default, 10);
                                stats.labels++;
                            }
                        }
                    }
                }
            }
            return { ...stats, state: { ...state } };
        },
        stats() { return { ...stats, state: { ...state }, stimuli: stimuli.length }; },
        dispose() {
            if (unsub) { try { unsub(); } catch (e) { /* снят */ } }
            unsub = null;
            stimuli.length = 0;
        },
    };
}

// ---------------------------------------------------------------------------
// 6. Roof fade audit + профиль/замеры + агрегатор
// ---------------------------------------------------------------------------

/**
 * Аудит roof fade: есть ли публичный API альфа-затухания поверхности Re2D.
 * Проверяются реальные имена (`surface(index)`), а не предположения.
 * Если API нет — возвращается `{ supported:false }` с честной причиной;
 * подделка через `sky(true)` (скрытие) в отчёт не выдаётся за fade.
 */
export function roofFadeAudit($, world = null) {
    // $.re2dWorld — только load/fromJSON; сам world-объект игра передаёт явно.
    const w = world || null;
    const surfaceApi = w && typeof w.surface === 'function';
    let surface = null;
    if (surfaceApi) {
        try { surface = w.surface(0); } catch (e) { surface = null; }
    }
    const hasFade = !!(surface && (typeof surface.fade === 'function' || typeof surface.alpha === 'function' || typeof surface.opacity === 'function'));
    const hasSky = !!(surface && typeof surface.sky === 'function');
    return {
        supported: hasFade,
        surfaceApi,
        hasSky,
        limitation: hasFade ? null
            : 'Re2D surface API has no alpha/fade (only .sky(true), which hides a ceiling — not a fade). ' +
              'Plain 2D can fade a roof <ceiling>/<sprite> node with .alpha(), but that is a node, not a Re2D surface.',
        workarounds: hasSky
            ? ['world.surface(i).sky(true) hides an open-sky ceiling (roof removed, not faded)',
               'plain 2D: fade the roof node with .alpha(value) if the roof is a normal node',
               'top-down: keep roofs as normal nodes when a fade is required']
            : ['plain 2D: fade the roof node with .alpha(value) if the roof is a normal node'],
    };
}

/**
 * Агрегатор P2-хелперов. Все части — обычные объекты, сцена тикает их сама:
 *   const fx = createPolish($, { world, roadGraph, population, decalProvider });
 *   fx.update(dt);  fx.debug.toggle('tags');  fx.debug.draw(dt);
 */
export function createPolish($, options = {}) {
    const opts = options || {};
    const decals = createDecalPool($, { ...(opts.decals || {}), provider: opts.decalProvider || (opts.decals && opts.decals.provider) || null });
    const vfx = createVfxAttach($, opts.vfx || {});
    const audio = createSpatialAudio($, opts.audio || {});
    const camera = opts.camera === false ? null : createTopDownCamera($, opts.camera || { apply: false });
    const debug = createDebugOverlay($, { ...(opts.debug || {}), world: opts.world || (opts.debug && opts.debug.world),
                                           roadGraph: opts.roadGraph || (opts.debug && opts.debug.roadGraph),
                                           population: opts.population || (opts.debug && opts.debug.population), h: opts.h });

    function measure(label, fn) {
        const profiler = $.debug && $.debug.profiler;
        const name = String(label || 'polish');
        const t0 = $.time && typeof $.time.perfNow === 'function' ? $.time.perfNow() : 0;
        let started = false;
        if (profiler && typeof profiler.start === 'function') { try { profiler.start(name); started = true; } catch (e) { started = false; } }
        let result;
        try {
            result = fn();
        } finally {
            const elapsed = ((($.time && typeof $.time.perfNow === 'function') ? $.time.perfNow() : 0) - t0) * 1000;
            if (started && typeof profiler.end === 'function') { try { profiler.end(name); } catch (e) { /* профилировщик выключен */ } }
            // Замер отдаём в миллисекундах (perfNow — секунды).
            measure._last = elapsed;
        }
        return { ms: measure._last, result };
    }

    return {
        decals, vfx, audio, camera, debug,
        update(dt) {
            decals.update(dt);
            vfx.update(dt);
            audio.update(dt);
            if (debug) debug.draw(dt);
            return { decals: decals.count(), emitters: vfx.count(), sounds: audio.count() };
        },
        measure,
        roofFade(world) { return roofFadeAudit($, world || opts.world); },
        profile() {
            const stats = {
                decals: decals.stats(),
                vfx: vfx.stats(),
                audio: audio.stats(),
                debug: debug.stats(),
                nodes: $.world && typeof $.world.count === 'function' ? $.world.count() : null,
                particles: $.vfx && typeof $.vfx.stats === 'function' ? $.vfx.stats() : null,
                camera: camera ? camera.info() : null,
            };
            return stats;
        },
    };
}
