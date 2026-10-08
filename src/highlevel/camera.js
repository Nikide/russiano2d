// ===========================================================================
// Камера: $.camera — слежение, зум, тряска, границы, перевод координат.
//
// В ядре камеры нет: сцена рисуется в координатах окна. Камера живёт здесь и
// применяется в момент отрисовки — $.gfx умножает мировые координаты узлов на
// матрицу камеры. Это значит, что .pos() у узла всегда мировые координаты, а
// экранные получаются через $.camera.worldToScreen().
// ===========================================================================

import { engine } from './native.js';
import { ctx, query, wrapOne, fxRandom } from './core.js';
import { setPrimaryCameraSource } from './viewports.js';
import { normalizeKind, KIND_2D, KIND_RE2D } from './kinds.js';

const cam = {
    x: 0, y: 0,          // центр камеры в мировых координатах
    zoom: 1,
    // Поворот кадра в РАДИАНАХ вокруг центра камеры. Мир при этом не
    // меняется: поворот применяется в момент отрисовки (render.js), поэтому
    // .pos() у узлов по-прежнему мировые координаты, а физика и лучи — как были.
    rotation: 0,
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

    // --- Вид камеры (docs/RE2D.md). '2d' — всё как раньше; 're2d' — взгляд от
    // первого лица: положение (x, y) — на полу, yaw — куда смотрим, pitch —
    // наклон вверх (радианы), eye — высота глаз, fov — вертикальный угол
    // обзора. Эти поля 2D-камера не читает, а метод rotation() в Re2D
    // работает с yaw, в 2D — с креном кадра.
    kind: KIND_2D,
    yaw: 0,               // куда смотрим; свой угол, чтобы не протекать в крен 2D-кадра (rotation)
    pitch: 0,
    eye: 48,
    fov: 70 * Math.PI / 180,
    fog_far: 0,
    fog_min: 0.25,
    look_on: false,       // взгляд мышью включён
    look_sens: 0.0025,    // радиан на пиксель сдвига мыши
};

const PITCH_LIMIT = 85 * Math.PI / 180;   // строго меньше 90°: иначе пол и потолок вырождаются
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Угол в диапазон (-π, π]: yaw не должен расти бесконечно при вращении мышью. */
function wrapAngle(a) {
    if (a > Math.PI || a <= -Math.PI) {
        a -= Math.floor((a + Math.PI) / TAU) * TAU;   // [-π, π)
        if (a <= -Math.PI) a = Math.PI;               // (-π, π]
    }
    return a;
}

/**
 * Параметры нативного вида из состояния камеры (чистая функция, тестируется
 * без движка). Зум в Re2D сужает угол обзора, а не масштабирует кадр: при
 * zoom = 2 угол по вертикали вдвое «уже» по тангенсу. Тряска — небольшой
 * поворот, а не сдвиг картинки: она смещает кадр на shake_x/shake_y пикселей.
 */
export function re2dViewOf(c) {
    const zoom = c.zoom > 0 ? c.zoom : 1;
    const fov = 2 * Math.atan(Math.tan(c.fov / 2) / zoom);
    const focal = (c.h / 2) / Math.tan(fov / 2);
    return {
        x: c.x, y: c.y, eye: c.eye,
        yaw: c.yaw - Math.atan2(c.shake_x || 0, focal),
        pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, c.pitch + Math.atan2(c.shake_y || 0, focal))),
        fov,
        fogFar: c.fogFar || 0,
        fogMin: c.fogMin === undefined ? 0.25 : c.fogMin,
    };
}

/** Поставить нативный вид (engine.re2d.view) по состоянию камеры. */
export function applyRe2dView(c) {
    const v = re2dViewOf(c);
    engine.re2d.view(v.x, v.y, v.eye, v.yaw, v.pitch, v.fov, v.fogFar, v.fogMin);
    return v;
}

function clampToLimits() {
    if (!cam.limits || cam.kind !== KIND_2D) return;
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


// ---------------------------------------------------------------------------
// Математика кадра: поворот + зум + сдвиг. Одна на всех — иначе отрисовка и
// $.camera.worldToScreen() разъехались бы при повороте (проверено тестом).
// ---------------------------------------------------------------------------

/** Мировая точка → экранная (в логических точках окна). */
export function frameWorldToScreen(cam_state, x, y, width, height) {
    const dx = (x - cam_state.x) * cam_state.zoom;
    const dy = (y - cam_state.y) * cam_state.zoom;
    const a = cam_state.rotation || 0;
    const c = Math.cos(a), s = Math.sin(a);
    return {
        // Знак минус у sin: положительный угол поворачивает МИР по часовой
        // стрелке на экране (как в 2D-играх), а не кадр против неё.
        x: dx * c - dy * s + width / 2,
        y: dx * s + dy * c + height / 2,
    };
}

/** Экранная точка → мировая. */
export function frameScreenToWorld(cam_state, x, y, width, height) {
    const px = x - width / 2;
    const py = y - height / 2;
    const a = cam_state.rotation || 0;
    const c = Math.cos(a), s = Math.sin(a);
    // Обратный поворот — транспонированная матрица.
    const dx = px * c + py * s;
    const dy = -px * s + py * c;
    return { x: dx / cam_state.zoom + cam_state.x, y: dy / cam_state.zoom + cam_state.y };
}

export function cameraTransform() {
    return {
        x: cam.x, y: cam.y, zoom: cam.zoom,
        rotation: cam.rotation,
        shake_x: cam.shake_x, shake_y: cam.shake_y,
        w: engine.width, h: engine.height,
        // Вид камеры и его параметры: 2D-проход их не читает, проход Re2D
        // берёт отсюда (render.js, re2d.js).
        kind: cam.kind, yaw: cam.yaw, pitch: cam.pitch, eye: cam.eye, fov: cam.fov,
        fogFar: cam.fog_far, fogMin: cam.fog_min,
    };
}

export function installCamera($, viewports) {
    // Модуль мультикамерности не должен сам лезть в $.camera: он спрашивает
    // главную камеру через эту функцию, поэтому порядок установки любой.
    setPrimaryCameraSource(() => cameraTransform());
    const camera = {
        at(x, y) {
            if (x === undefined) return { x: cam.x, y: cam.y };
            if (typeof x === 'object') { cam.x = x.x; cam.y = x.y; }
            else { cam.x = x; cam.y = y; }
            clampToLimits();
            return camera;
        },

        // --- Несколько камер (сплитскрин) ----------------------------------
        // Подробности и ограничения — docs/highlevel/camera.md §1.2.
        add(name, opts) { return viewports.add(name, opts); },
        remove(name) { return viewports.remove(name); },
        list() { return viewports.list(); },
        camCount() { return viewports.count(); },
        split(count, opts) { return viewports.split(count, opts); },
        viewAt(name, x, y) { return viewports.at(name, x, y); },
        viewZoom(name, value) { return viewports.zoom(name, value); },
        region(name, rect) { return viewports.region(name, rect); },
        views() { return viewports.describe(); },

        // Картинка в картинке и миникарта (viewports.md §3.1).
        pip(rect, opts) { return viewports.pip(rect, opts); },
        pipClear() { return viewports.pipClear(); },
        pipInfo() { return viewports.pipInfo(); },
        minimap(rect, opts) { return viewports.minimap(rect, opts); },

        // Картинка в картинке и миникарта (viewports.md §3.1).
        minimap(rect, opts) { return viewports.minimap(rect, opts); },

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

        /**
         * Снимок состояния камеры: цель слежения, сглаживание, границы,
         * мёртвая зона, зум и смещение. Нужен катсценам: без него «вернуть как
         * было» приходится в каждом месте вручную, и что-то обязательно
         * теряется.
         */
        snapshot() {
            return {
                x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation,
                kind: cam.kind, yaw: cam.yaw, pitch: cam.pitch, eye: cam.eye, fov: cam.fov,
                fogFar: cam.fog_far, fogMin: cam.fog_min,
                target: cam.target, offset: { x: cam.offset.x, y: cam.offset.y },
                smooth: cam.smooth,
                limits: cam.limits ? { x: cam.limits.x, y: cam.limits.y, w: cam.limits.w, h: cam.limits.h } : null,
                deadzone: cam.deadzone ? { w: cam.deadzone.w, h: cam.deadzone.h } : null,
            };
        },

        /** Вернуть камеру в снятое состояние (`snapshot()`). */
        restore(state) {
            if (!state) return camera;
            cam.x = state.x; cam.y = state.y;
            cam.zoom = Math.max(0.01, state.zoom);
            cam.rotation = Number(state.rotation) || 0;
            // Поля вида: снимок из старой версии их не содержит — берём умолчания.
            cam.kind = state.kind && typeof state.kind === 'string' ? state.kind : KIND_2D;
            cam.yaw = Number(state.yaw) || 0;
            cam.pitch = Number(state.pitch) || 0;
            cam.eye = state.eye === undefined ? 48 : Number(state.eye);
            cam.fov = state.fov === undefined ? 70 * DEG : Number(state.fov);
            cam.fog_far = Number(state.fogFar) || 0;
            cam.fog_min = state.fogMin === undefined ? 0.25 : Number(state.fogMin);
            cam.target = state.target || null;
            cam.offset.x = state.offset ? state.offset.x : 0;
            cam.offset.y = state.offset ? state.offset.y : 0;
            cam.smooth = state.smooth || 0;
            cam.limits = state.limits ? Object.assign({}, state.limits) : null;
            cam.deadzone = state.deadzone ? Object.assign({}, state.deadzone) : null;
            clampToLimits();
            return camera;
        },

        /**
         * Поворот кадра: `$.camera.rotation(Math.PI / 4)`.
         *
         * Вращается ВСЁ, что рисуется миром: спрайты, треугольники, слои,
         * частицы. Координаты узлов остаются мировыми — меняется только
         * картинка, поэтому физика, лучи и пикинг работают как обычно.
         * Без аргумента — геттер.
         */
        rotation(value) {
            // В Re2D «поворот кадра» — это куда смотрим (yaw); у 2D-кадра свой крен.
            if (cam.kind === KIND_RE2D) {
                if (value === undefined) return cam.yaw;
                cam.yaw = wrapAngle(Number(value) || 0);
                return camera;
            }
            if (value === undefined) return cam.rotation;
            cam.rotation = Number(value) || 0;
            return camera;
        },

        /** Плавный поворот к углу (радианы) за `ms` миллисекунд. */
        rotateTo(value, ms) {
            const field = cam.kind === KIND_RE2D ? 'yaw' : 'rotation';
            const from = cam[field];
            const to = Number(value) || 0;
            if (!(ms > 0)) { cam[field] = to; return camera; }
            animate(ms, (p) => { cam[field] = from + (to - from) * p; });
            return camera;
        },

        // --- Вид камеры: Re2D (docs/RE2D.md) -----------------------------------
        // Те же методы, что и в 2D, получают смысл «взгляда от первого лица»:
        // at/follow — положение глаз на полу, rotation — yaw, zoom — сужение
        // угла обзора. Новые слова заведены только там, где в 2D смысла нет.

        /** Вид камеры: '2d' (по умолчанию) или 're2d'. `.kind(null)` вернёт 2D. */
        kind(value) {
            if (value === undefined) return cam.kind;
            cam.kind = normalizeKind(value);
            return camera;
        },

        /** Куда смотрим, градусы (в Re2D это же поле читает rotation() в радианах). */
        yaw(value) {
            if (value === undefined) return cam.yaw / DEG;
            cam.yaw = wrapAngle((Number(value) || 0) * DEG);
            return camera;
        },

        /** Наклон вверх-вниз, градусы; зажат в ±85°. */
        pitch(value) {
            if (value === undefined) return cam.pitch / DEG;
            cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, (Number(value) || 0) * DEG));
            return camera;
        },

        /** Высота глаз над полом (пиксели мира). */
        eye(value) {
            if (value === undefined) return cam.eye;
            cam.eye = Number(value) || 0;
            return camera;
        },

        /** Вертикальный угол обзора, градусы (до зума). */
        fov(value) {
            if (value === undefined) return cam.fov / DEG;
            cam.fov = Math.max(5, Math.min(170, Number(value) || 70)) * DEG;
            return camera;
        },

        /** Затемнение с расстоянием: `fog(far, min)`; `fog(0)` выключает. */
        fog(far, min) {
            if (far === undefined) return { far: cam.fog_far, min: cam.fog_min };
            cam.fog_far = Math.max(0, Number(far) || 0);
            if (min !== undefined) cam.fog_min = Math.max(0, Math.min(1, Number(min) || 0));
            return camera;
        },

        /**
         * Повернуть взгляд на сдвиг мыши в пикселях: вправо — поворот направо,
         * вверх — взгляд вверх. Работает и без `mouseLook`, например из
         * геймпада или теста.
         */
        look(dx, dy) {
            cam.yaw = wrapAngle(cam.yaw + (Number(dx) || 0) * cam.look_sens);
            cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch - (Number(dy) || 0) * cam.look_sens));
            return camera;
        },

        /**
         * Взгляд мышью. `mouseLook(true)` захватывает мышь (курсор скрыт,
         * движение относительное) и каждый кадр поворачивает камеру Re2D на
         * сдвиг мыши; `mouseLook({ sensitivity })` — радианы на пиксель;
         * без аргументов — включён ли.
         */
        mouseLook(opts) {
            if (opts === undefined) return cam.look_on;
            const o = (opts && typeof opts === 'object') ? opts : { on: !!opts };
            if (o.sensitivity !== undefined) cam.look_sens = Math.max(0, Number(o.sensitivity) || 0);
            if (o.on !== undefined || typeof opts !== 'object') {
                cam.look_on = o.on !== false;
                if ($.window && typeof $.window.mouseLock === 'function') $.window.mouseLock(cam.look_on);
            }
            return camera;
        },

        /** Факты о камере структурой: вид, положение, углы в градусах, взгляд мышью. */
        info() {
            return {
                kind: cam.kind, x: cam.x, y: cam.y, eye: cam.eye,
                yaw: cam.yaw / DEG, pitch: cam.pitch / DEG, fov: cam.fov / DEG,
                zoom: cam.zoom, fogFar: cam.fog_far, fogMin: cam.fog_min,
                mouseLook: cam.look_on, sensitivity: cam.look_sens,
            };
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
            if (cam.kind === KIND_RE2D) return re2dWorldToScreen(pt, p);
            const state = { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation };
            const out = frameWorldToScreen(state, pt.x, pt.y, engine.width, engine.height);
            // Тряска — поверх всего: она сдвигает кадр, а не мир.
            out.x += cam.shake_x;
            out.y += cam.shake_y;
            return out;
        },

        screenToWorld(p) {
            const pt = toPoint(p);
            if (cam.kind === KIND_RE2D) {
                // Пиксель → точка на полу (или на высоте p.z): луч из глаз.
                applyRe2dView(cameraTransform());
                const hit = engine.re2d.unproject(pt.x, pt.y, p && typeof p === 'object' && p.z ? Number(p.z) : 0);
                return hit ? { x: hit[0], y: hit[1] } : null;
            }
            const state = { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation };
            return frameScreenToWorld(state, pt.x - cam.shake_x, pt.y - cam.shake_y,
                                      engine.width, engine.height);
        },

        /** Видно ли то, что передали (узел, селектор или точка). */
        isOnScreen(what) {
            if (cam.kind === KIND_RE2D) {
                if (typeof what === 'string') return query(what).some((n) => camera.isOnScreen(n));
                if (typeof what === 'object' && what && what.tag && what.attrs.ui) return true;
                const s = re2dWorldToScreen(toPoint(what), what);
                return s.visible && s.x >= 0 && s.x <= engine.width && s.y >= 0 && s.y <= engine.height;
            }
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
            if (cam.kind === KIND_RE2D && cam.look_on && $.input) {
                // Взгляд мышью: сдвиг за кадр (в записи/реплее он тоже есть).
                const m = $.input.mouseDelta();
                if (m && (m.x || m.y)) camera.look(m.x, m.y);
            }
            if (cam.target) {
                const node = resolveTarget(cam.target);
                if (node) {
                    const tx = node.x + cam.offset.x;
                    const ty = node.y + cam.offset.y;
                    if (cam.kind === KIND_RE2D) {
                        // Глаза не «плывут» за телом: от первого лица слежение мгновенное.
                        cam.x = tx;
                        cam.y = ty;
                    } else if (cam.deadzone) {
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

/**
 * Re2D: мировая точка → экран через нативную проекцию (одна реализация
 * математики — engine.re2d). Высота берётся из p.z / p.depth (у узлов это
 * `.depth`), по умолчанию — пол.
 */
function re2dWorldToScreen(pt, source) {
    applyRe2dView(cameraTransform());
    let node = source;
    if (typeof node === 'string') node = query(node)[0];
    else if (node && node.nodes) node = node.nodes[0];
    const z = node && typeof node === 'object'
        ? Number(node.z !== undefined ? node.z : (node.depth !== undefined ? node.depth : 0)) || 0 : 0;
    const out = new Float32Array(4);
    const visible = engine.re2d.project(new Float32Array([pt.x, pt.y, z]), out) > 0;
    return { x: out[0], y: out[1], scale: out[3], depth: out[2], visible };
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
