// ===========================================================================
// Камера: $.camera — слежение, зум, тряска, границы, перевод координат.
//
// В ядре камеры нет: сцена рисуется в координатах окна. Камера живёт здесь и
// применяется в момент отрисовки — $.gfx умножает мировые координаты узлов на
// матрицу камеры. Это значит, что .pos() у узла всегда мировые координаты, а
// экранные получаются через $.camera.worldToScreen().
// ===========================================================================

import { ctx, query, wrapOne, fxRandom } from './core.js';

const cam = {
    x: 0, y: 0,          // центр камеры в мировых координатах
    zoom: 1,
    target: null,        // узел, за которым следим
    offset: { x: 0, y: 0 },
    smooth: 0,           // 0 — мгновенно, 1 — «прилипание» без движения
    limits: null,        // { x, y, w, h } — куда камере можно
    deadzone: null,      // { w, h }
    shake_t: 0,
    shake_total: 0,
    shake_amp: 0,
    shake_x: 0,
    shake_y: 0,
};

function clampToLimits() {
    if (!cam.limits) return;
    const half_w = engine.width / (2 * cam.zoom);
    const half_h = engine.height / (2 * cam.zoom);
    const { x, y, w, h } = cam.limits;
    const min_x = x + Math.min(half_w, w / 2);
    const max_x = x + w - Math.min(half_w, w / 2);
    const min_y = y + Math.min(half_h, h / 2);
    const max_y = y + h - Math.min(half_h, h / 2);
    cam.x = Math.max(min_x, Math.min(max_x, cam.x));
    cam.y = Math.max(min_y, Math.min(max_y, cam.y));
}

export function cameraTransform() {
    return {
        x: cam.x, y: cam.y, zoom: cam.zoom,
        shake_x: cam.shake_x, shake_y: cam.shake_y,
        w: engine.width, h: engine.height,
    };
}

export function installCamera($) {
    const camera = {
        at(x, y) {
            if (x === undefined) return { x: cam.x, y: cam.y };
            if (typeof x === 'object') { cam.x = x.x; cam.y = x.y; }
            else { cam.x = x; cam.y = y; }
            clampToLimits();
            return camera;
        },

        pos() { return { x: cam.x, y: cam.y }; },
        x() { return cam.x; },
        y() { return cam.y; },

        follow(selector, opts) {
            const o = opts || {};
            // Селектор и индекс храним как есть — узел может появиться позже,
            // а узел или обёртку принимаем объектом: resolveTarget умеет и то,
            // и другое. Раньше объект молча давал cam.target = null, и камера
            // не двигалась, хотя follow() возвращал себя для цепочки.
            const known = typeof selector === 'string' || typeof selector === 'number' ||
                (selector && (selector.tag || selector.nodes));
            cam.target = known ? selector : null;
            cam.offset = { x: o.offset ? o.offset[0] : (o.x || 0), y: o.offset ? o.offset[1] : (o.y || 0) };
            cam.smooth = o.smooth === undefined ? 0.12 : o.smooth;
            if (o.zoom !== undefined) cam.zoom = o.zoom;
            return camera;
        },

        unfollow() { cam.target = null; cam.smooth = 0; return camera; },

        /** Узел, за которым следим сейчас (или null). */
        followed() {
            if (!cam.target) return null;
            const node = resolveTarget(cam.target);
            return node ? wrapOne(node) : null;
        },

        zoom(value) {
            if (value === undefined) return cam.zoom;
            cam.zoom = Math.max(0.01, value);
            clampToLimits();
            return camera;
        },

        zoomTo(value, ms) {
            const from = cam.zoom;
            return animate(ms, (p) => { cam.zoom = from + (value - from) * p; });
        },

        panTo(x, y, ms) {
            const fx = cam.x, fy = cam.y;
            return animate(ms, (p) => { cam.x = fx + (x - fx) * p; cam.y = fy + (y - fy) * p; clampToLimits(); });
        },

        /** Тряска: амплитуда в пикселях, длительность в миллисекундах. */
        shake(intensity, ms) {
            cam.shake_amp = Math.max(cam.shake_amp, intensity || 4);
            cam.shake_total = cam.shake_t = (ms || 250) / 1000;
            return camera;
        },

        limits(x, y, w, h) {
            cam.limits = (x === null) ? null : { x, y, w, h };
            clampToLimits();
            return camera;
        },

        deadzone(w, h) {
            cam.deadzone = (w === null) ? null : { w, h };
            return camera;
        },

        worldToScreen(p) {
            const pt = toPoint(p);
            return {
                x: (pt.x - cam.x) * cam.zoom + engine.width / 2 + cam.shake_x,
                y: (pt.y - cam.y) * cam.zoom + engine.height / 2 + cam.shake_y,
            };
        },

        screenToWorld(p) {
            const pt = toPoint(p);
            return {
                x: (pt.x - engine.width / 2 - cam.shake_x) / cam.zoom + cam.x,
                y: (pt.y - engine.height / 2 - cam.shake_y) / cam.zoom + cam.y,
            };
        },

        /** Видно ли то, что передали (узел, селектор или точка). */
        isOnScreen(what) {
            const half_w = engine.width / (2 * cam.zoom) + 64;
            const half_h = engine.height / (2 * cam.zoom) + 64;
            if (typeof what === 'string') return query(what).some((n) => camera.isOnScreen(n));
            if (typeof what === 'object' && what && what.tag) {
                if (what.attrs.ui) return true;
                return Math.abs(what.x - cam.x) <= half_w + what.w / 2 &&
                       Math.abs(what.y - cam.y) <= half_h + what.h / 2;
            }
            const pt = toPoint(what);
            return Math.abs(pt.x - cam.x) <= half_w && Math.abs(pt.y - cam.y) <= half_h;
        },

        /** Видимый прямоугольник мира — для отсечения и спавна. */
        viewport() {
            const half_w = engine.width / (2 * cam.zoom);
            const half_h = engine.height / (2 * cam.zoom);
            return { x: cam.x - half_w, y: cam.y - half_h, w: half_w * 2, h: half_h * 2 };
        },

        /** Внутреннее: вызывается из $.time каждый кадр. */
        _tick(dt) {
            if (cam.target) {
                const node = resolveTarget(cam.target);
                if (node) {
                    const tx = node.x + cam.offset.x;
                    const ty = node.y + cam.offset.y;
                    if (cam.deadzone) {
                        const dx = tx - cam.x, dy = ty - cam.y;
                        const hw = cam.deadzone.w / 2, hh = cam.deadzone.h / 2;
                        if (Math.abs(dx) > hw) cam.x += dx - Math.sign(dx) * hw;
                        if (Math.abs(dy) > hh) cam.y += dy - Math.sign(dy) * hh;
                    } else if (cam.smooth > 0) {
                        const k = 1 - Math.pow(cam.smooth, dt * 60);
                        cam.x += (tx - cam.x) * k;
                        cam.y += (ty - cam.y) * k;
                    } else {
                        cam.x = tx;
                        cam.y = ty;
                    }
                }
            }
            if (cam.shake_t > 0) {
                cam.shake_t -= dt;
                const p = Math.max(0, cam.shake_t / cam.shake_total);
                const amp = cam.shake_amp * p;
                cam.shake_x = (fxRandom() * 2 - 1) * amp;
                cam.shake_y = (fxRandom() * 2 - 1) * amp;
            } else {
                cam.shake_x = 0;
                cam.shake_y = 0;
                cam.shake_amp = 0;
            }
            clampToLimits();
        },

        _state: cam,
    };

    ctx.camera = camera;
    return camera;
}

function resolveTarget(target) {
    if (typeof target === 'string') return query(target)[0] || null;
    if (typeof target === 'number') return ctx.nodes[target] || null;
    if (target && target.nodes) return target.nodes[0] || null;
    if (target && target.tag) return target;
    return null;
}

function toPoint(p) {
    if (p === undefined || p === null) return { x: 0, y: 0 };
    if (typeof p === 'string') { const n = query(p)[0]; return n ? { x: n.x, y: n.y } : { x: 0, y: 0 }; }
    if (typeof p === 'object' && p.nodes) return p.nodes[0] ? { x: p.nodes[0].x, y: p.nodes[0].y } : { x: 0, y: 0 };
    if (typeof p === 'object' && p.tag) return { x: p.x, y: p.y };
    return { x: p.x || 0, y: p.y || 0 };
}

// Простая анимация без узла: используется zoomTo/panTo.
function animate(ms, apply) {
    if (!(ms > 0)) { apply(1); return Promise.resolve(); }
    return new Promise((resolve) => {
        ctx.animations.push({ t: 0, ms, apply, resolve });
    });
}

export function tickCameraAnimations(dt) {
    if (!ctx.animations.length) return;
    const ms = dt * 1000;
    for (let i = ctx.animations.length - 1; i >= 0; i--) {
        const a = ctx.animations[i];
        a.t += ms;
        const p = Math.min(1, a.t / a.ms);
        a.apply(p * p * (3 - 2 * p));
        if (p >= 1) { ctx.animations.splice(i, 1); a.resolve(); }
    }
}
