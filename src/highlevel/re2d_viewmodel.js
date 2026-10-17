// ===========================================================================
// Re2D viewmodel — экранный 2D-хелпер оружия от первого лица.
//
// Правило движка: viewmodel — screen-space 2D, а не меш/3D-модель. Помощник не
// рисует сам и не знает про камеру: он двигает ОБЫЧНЫЙ узел `$`
// (`<ui.image>`, `<sprite>`, `<rect>`) через три метода — `.at(x,y)`,
// `.size(w,h)`, `.frame(i)`. Всё остальное (атлас кадров, слой HUD, z-порядок)
// остаётся делом игры и существующего UI.
//
//   const vm = $.re2dViewmodel({
//     node: $('<ui.image>', { id: 'gun' })
//       .frames({ src: 'art/gun.png', cols: 3, rows: 2, cw: 128, ch: 128 })
//       .appendTo($.ui),
//     base: { x: 640, y: 620, w: 512, h: 512 },
//     clips: {
//       idle: { frames: [0], ms: 100, loop: true },
//       fire: { frames: [1, 2, 3, 0], ms: [25, 30, 25, 20], loop: false, events: { 1: 'fire' } },
//     },
//     recoil: { back: 8, up: 6, decay: 14 },
//     bob: { amp: 3, speed: 9 },
//     sway: { amp: 4, smooth: 8 },
//   });
//   vm.on('fire', () => muzzleFlash());       // маркер кадра, ровно один раз
//   vm.play('fire').speed(player.speed).look(mouse.dx, mouse.dy).recoil(1);
//   $.update(dt => vm.update(dt));            // кадр игры
//
// Числа аналитические: ни Math.random, ни Date, поэтому одинаковый ввод даёт
// одинаковые состояния. `update` не создаёт объектов — только считает и
// двигает узел. `state()` создаёт снимок (не каждый кадр).
// ===========================================================================

const MAX_DT = 0.25;              // сек; кадр после паузы не «прыгает»
const BOB_REF_SPEED = 200;        // скорость, при которой bob выходит на amp
const SHAKE_AMP = 6;              // пикселей на единицу shake
const SHAKE_DECAY = 10;           // 1/сек
const SHAKE_X_RATE = 37;          // рад/сек аналитической тряски
const SHAKE_Y_RATE = 29;

function fail(label, message) {
    throw new RangeError('re2dViewmodel: ' + label + ' ' + message);
}

function finite(value, label) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new TypeError('re2dViewmodel: ' + label + ' must be finite');
    return n;
}

function nonNegative(value, label) {
    const n = finite(value, label);
    if (n < 0) fail(label, 'must be >= 0');
    return n;
}

function positive(value, label) {
    const n = finite(value, label);
    if (!(n > 0)) fail(label, 'must be > 0');
    return n;
}

function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('re2dViewmodel: ' + label + ' must be an object');
    }
    return value;
}

function optionalObject(value, label) {
    if (value === undefined || value === null) return {};
    return object(value, label);
}

function clampStep(dt) {
    if (dt === undefined || dt === null) return 0;
    const value = Number(dt);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value > MAX_DT ? MAX_DT : value;
}

/** Нормализовать клип: массивы кадров/мс и список маркеров. */
function normalizeClip(name, spec) {
    object(spec, 'clips.' + name);
    const frames = spec.frames;
    if (!Array.isArray(frames) || frames.length === 0) {
        fail('clips.' + name + '.frames', 'must be a non-empty array');
    }
    const outFrames = new Array(frames.length);
    for (let i = 0; i < frames.length; i++) {
        const frame = Number(frames[i]);
        if (!Number.isInteger(frame) || frame < 0) {
            fail('clips.' + name + '.frames[' + i + ']', 'must be an integer >= 0');
        }
        outFrames[i] = frame;
    }

    const rawMs = spec.ms;
    const outMs = new Array(frames.length);
    if (Array.isArray(rawMs)) {
        if (rawMs.length !== frames.length) {
            fail('clips.' + name + '.ms', 'array length must equal frames length');
        }
        for (let i = 0; i < rawMs.length; i++) outMs[i] = positive(rawMs[i], 'clips.' + name + '.ms[' + i + ']');
    } else if (rawMs !== undefined) {
        const ms = positive(rawMs, 'clips.' + name + '.ms');
        for (let i = 0; i < outMs.length; i++) outMs[i] = ms;
    } else {
        fail('clips.' + name + '.ms', 'is required');
    }

    if (spec.loop !== undefined && typeof spec.loop !== 'boolean') {
        throw new TypeError('re2dViewmodel: clips.' + name + '.loop must be boolean');
    }

    const events = [];
    if (spec.events !== undefined && spec.events !== null) {
        object(spec.events, 'clips.' + name + '.events');
        for (const key of Object.keys(spec.events)) {
            const frame = Number(key);
            if (!Number.isInteger(frame) || frame < 0 || frame >= frames.length) {
                fail('clips.' + name + '.events', 'unknown frame ' + key);
            }
            const marker = spec.events[key];
            if (typeof marker !== 'string' || marker.length === 0) {
                throw new TypeError('re2dViewmodel: clips.' + name + '.events[' + key + '] must be a non-empty string');
            }
            events.push({ frame, name: marker });
        }
    }

    return {
        name,
        frames: outFrames,
        ms: outMs,
        loop: spec.loop === true,
        events,
    };
}

function readBase(options, node) {
    if (options.base !== undefined && options.base !== null) {
        const base = object(options.base, 'base');
        const w = positive(base.w, 'base.w');
        const h = positive(base.h, 'base.h');
        return { x: finite(base.x, 'base.x'), y: finite(base.y, 'base.y'), w, h };
    }
    if (typeof node.get !== 'function') {
        throw new TypeError('re2dViewmodel: base is required when node.get is missing');
    }
    const raw = node.get(0);
    if (!raw || typeof raw !== 'object') {
        throw new TypeError('re2dViewmodel: base is required when node.get(0) is empty');
    }
    return {
        x: finite(raw.x, 'base.x'),
        y: finite(raw.y, 'base.y'),
        w: positive(raw.w, 'base.w'),
        h: positive(raw.h, 'base.h'),
    };
}

function checkNode(node) {
    object(node, 'node');
    for (const method of ['at', 'size', 'frame']) {
        if (typeof node[method] !== 'function') {
            throw new TypeError('re2dViewmodel: node.' + method + '() is required');
        }
    }
}

/** Создать viewmodel поверх обычного узла `$`. */
function createViewmodel($, options) {
    object(options, 'options');
    const node = options.node;
    checkNode(node);
    const base = readBase(options, node);

    const clipsOption = object(options.clips, 'clips');
    const names = Object.keys(clipsOption);
    if (names.length === 0) fail('clips', 'must contain at least one clip');
    const clips = Object.create(null);
    for (const name of names) clips[name] = normalizeClip(name, clipsOption[name]);

    const recoilOption = optionalObject(options.recoil, 'recoil');
    const recoilBack = nonNegative(recoilOption.back === undefined ? 8 : recoilOption.back, 'recoil.back');
    const recoilUp = nonNegative(recoilOption.up === undefined ? 6 : recoilOption.up, 'recoil.up');
    const recoilDecay = nonNegative(recoilOption.decay === undefined ? 14 : recoilOption.decay, 'recoil.decay');

    const bobOption = optionalObject(options.bob, 'bob');
    const bobAmpMax = nonNegative(bobOption.amp === undefined ? 3 : bobOption.amp, 'bob.amp');
    const bobSpeed = nonNegative(bobOption.speed === undefined ? 9 : bobOption.speed, 'bob.speed');

    const swayOption = optionalObject(options.sway, 'sway');
    const swayAmp = nonNegative(swayOption.amp === undefined ? 4 : swayOption.amp, 'sway.amp');
    const swaySmooth = nonNegative(swayOption.smooth === undefined ? 8 : swayOption.smooth, 'sway.smooth');

    const initialName = clips.idle !== undefined ? 'idle' : names[0];
    let clip = clips[initialName];
    let frameIndex = 0;
    let frameTime = 0;              // мс в текущем кадре
    let ended = false;

    let speedValue = 0;
    let recoilValue = 0;
    let bobPhase = 0;
    let bobAmp = 0;
    let swayX = 0, swayY = 0;
    let swayTargetX = 0, swayTargetY = 0;
    let shakeValue = 0;
    let shakeTime = 0;

    const listeners = Object.create(null);
    const api = {};

    function emit(name) {
        const list = listeners[name];
        if (list === undefined) return;
        for (let i = 0; i < list.length; i++) list[i](api);
    }

    function emitFrame(index) {
        const events = clip.events;
        for (let i = 0; i < events.length; i++) {
            if (events[i].frame === index) emit(events[i].name);
        }
    }

    // Применить текущее состояние к узлу. Только три метода узла: at/size/frame.
    function apply() {
        const bob = Math.sin(bobPhase) * bobAmp;
        const shakeX = Math.sin(shakeTime * SHAKE_X_RATE) * shakeValue * SHAKE_AMP;
        const shakeY = Math.cos(shakeTime * SHAKE_Y_RATE) * shakeValue * SHAKE_AMP;
        const recoilY = (recoilBack - recoilUp) * recoilValue;
        node.at(base.x + swayX + shakeX, base.y + recoilY + bob + swayY + shakeY);
        node.size(base.w, base.h);
        node.frame(clip.frames[frameIndex]);
    }

    function advance(dt) {
        if (ended) return;
        frameTime += dt * 1000;
        // Предел на случай пачки кадров в одном update: dt уже ≤ 0.25 с.
        let guard = 0;
        while (frameTime >= clip.ms[frameIndex] && guard++ < 4096) {
            frameTime -= clip.ms[frameIndex];
            const last = frameIndex + 1 >= clip.frames.length;
            if (last) {
                if (clip.loop) {
                    frameIndex = 0;
                    emitFrame(0);
                } else {
                    ended = true;
                    frameTime = 0;
                    emit('end');
                    break;
                }
            } else {
                frameIndex++;
                emitFrame(frameIndex);
            }
        }
    }

    api.play = function play(name) {
        if (typeof name !== 'string') throw new TypeError('re2dViewmodel: clip name must be a string');
        const next = clips[name];
        if (next === undefined) fail('play', 'unknown clip "' + name + '"');
        clip = next;
        frameIndex = 0;
        frameTime = 0;
        ended = false;
        apply();
        emitFrame(0);
        return api;
    };

    api.update = function update(dt) {
        const step = clampStep(dt);
        if (step === 0) return api;           // dt=0 — честный no-op
        advance(step);

        if (recoilValue > 0) {
            recoilValue *= Math.exp(-recoilDecay * step);
            if (recoilValue < 1e-4) recoilValue = 0;
        }

        const speedNorm = Math.min(1, Math.abs(speedValue) / BOB_REF_SPEED);
        const bobTarget = bobAmpMax * speedNorm;
        bobAmp += (bobTarget - bobAmp) * (1 - Math.exp(-8 * step));
        if (Math.abs(bobAmp) < 1e-4) bobAmp = 0;
        bobPhase += step * bobSpeed * (0.25 + speedNorm);

        if (swayTargetX !== 0 || swayTargetY !== 0 || swayX !== 0 || swayY !== 0) {
            const decay = Math.exp(-swaySmooth * step);
            swayTargetX *= decay;
            swayTargetY *= decay;
            const follow = 1 - decay;
            swayX += (swayTargetX - swayX) * follow;
            swayY += (swayTargetY - swayY) * follow;
            if (Math.abs(swayTargetX) < 1e-4) swayTargetX = 0;
            if (Math.abs(swayTargetY) < 1e-4) swayTargetY = 0;
            if (Math.abs(swayX) < 1e-4) swayX = 0;
            if (Math.abs(swayY) < 1e-4) swayY = 0;
        }

        shakeTime += step;
        if (shakeValue > 0) {
            shakeValue *= Math.exp(-SHAKE_DECAY * step);
            if (shakeValue < 1e-4) shakeValue = 0;
        }

        apply();
        return api;
    };

    api.speed = function speed(value) {
        if (value === undefined) return speedValue;
        speedValue = finite(value, 'speed');
        return api;
    };

    api.look = function look(dx, dy) {
        const x = finite(dx, 'look.dx');
        const y = finite(dy === undefined ? 0 : dy, 'look.dy');
        swayTargetX += x * swayAmp;
        swayTargetY += y * swayAmp;
        const limit = swayAmp * 12;
        if (swayTargetX > limit) swayTargetX = limit;
        if (swayTargetX < -limit) swayTargetX = -limit;
        if (swayTargetY > limit) swayTargetY = limit;
        if (swayTargetY < -limit) swayTargetY = -limit;
        return api;
    };

    api.recoil = function recoil(amount) {
        const value = nonNegative(amount === undefined ? 1 : amount, 'recoil');
        recoilValue = Math.min(1, recoilValue + value);
        return api;
    };

    api.shake = function shake(amount) {
        shakeValue += nonNegative(amount === undefined ? 1 : amount, 'shake');
        return api;
    };

    api.on = function on(name, callback) {
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('re2dViewmodel: event name must be a non-empty string');
        }
        if (typeof callback !== 'function') {
            throw new TypeError('re2dViewmodel: listener must be a function');
        }
        const list = listeners[name] || (listeners[name] = []);
        list.push(callback);
        return api;
    };

    api.off = function off(name, callback) {
        const list = listeners[name];
        if (list === undefined) return api;
        if (callback === undefined) { list.length = 0; return api; }
        const at = list.indexOf(callback);
        if (at >= 0) list.splice(at, 1);
        return api;
    };

    api.state = function state() {
        return {
            clip: clip.name,
            frame: frameIndex,
            ended,
            recoil: recoilValue,
            bob: bobAmp,
            sway: { x: swayX, y: swayY },
            shake: shakeValue,
        };
    };

    // Стартовый кадр idle/первого клипа — сразу, до первого update.
    apply();
    return api;
}

/** Установить `$.re2dViewmodel` и `$.re2dFeel` (чистые camera-feel значения). */
export function installRe2dViewmodel($) {
    if (!$ || (typeof $ !== 'function' && typeof $ !== 'object')) {
        throw new TypeError('installRe2dViewmodel: $ API is required');
    }

    $.re2dViewmodel = function re2dViewmodel(options) {
        return createViewmodel($, options);
    };

    const feelObject = (value, label) => object(value, label);
    const feelAmount = (value) => nonNegative(value === undefined ? 1 : value, 'amount');

    $.re2dFeel = {
        /** Импульс отдачи: сколько пикселей назад/вверх на единицу силы. */
        recoil(amount, options) {
            const a = feelAmount(amount);
            const o = feelObject(options === undefined ? {} : options, 'feel.recoil options');
            const back = nonNegative(o.back === undefined ? 8 : o.back, 'feel.recoil.back');
            const up = nonNegative(o.up === undefined ? 6 : o.up, 'feel.recoil.up');
            return { back: a * back, up: a * up };
        },
        /** Значение тряски камеры (пиксели): чистое число, камеру двигает игра. */
        shake(amount, options) {
            const a = feelAmount(amount);
            const o = feelObject(options === undefined ? {} : options, 'feel.shake options');
            const amp = nonNegative(o.amp === undefined ? 6 : o.amp, 'feel.shake.amp');
            return a * amp;
        },
        /** FOV kick в градусах: прибавка к fov, не владение камерой. */
        fov(amount, options) {
            const a = feelAmount(amount);
            const o = feelObject(options === undefined ? {} : options, 'feel.fov options');
            const kick = finite(o.kick === undefined ? 6 : o.kick, 'feel.fov.kick');
            return a * kick;
        },
        /** Аналитическое затухание значения за dt (dt зажимается в 0..0.25). */
        decay(value, rate, dt) {
            const v = finite(value, 'feel.decay value');
            const r = nonNegative(rate === undefined ? 14 : rate, 'feel.decay rate');
            return v * Math.exp(-r * clampStep(dt));
        },
    };

    return $;
}

export default installRe2dViewmodel;
