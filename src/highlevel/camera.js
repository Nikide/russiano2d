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
    // Lookahead платформера: камера смотрит на столько пикселей вперёд по
    // направлению движения цели. Значение — максимум выноса; сам вынос
    // сглаживается (lookahead_smooth), чтобы разворот не дёргал кадр.
    lookahead: 0,
    lookahead_y: 0,
    lookahead_smooth: 0.9,
    lead_x: 0,           // текущий сглаженный вынос по X/Y
    lead_y: 0,
    prev_target: null,   // { x, y } позиция цели на прошлом тике — из неё скорость
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

// ---------------------------------------------------------------------------
// Защита от мусора на входе (§49)
//
// Камера — общий множитель для ВСЕЙ отрисовки: одна NaN в cam.x превращает в
// NaN мировые координаты экрана, отсечение, пикинг и позиции спрайтов, а в JSON
// это выглядит как null. Раньше так и было: zoom(NaN), at(NaN, NaN),
// shake(NaN), limits(NaN, …) и follow({ offset: [NaN, 0] }) утекали в кадр.
// Теперь у каждого входа определённый ответ:
//   * координата/размер/зум — только конечное число; иначе значение не меняется;
//   * амплитуда тряски — конечное число > 0; иначе это «стоп»;
//   * доля сглаживания — [0, 1]; NaN — мгновенное слежение (0), ±∞ — край.
// ---------------------------------------------------------------------------

/** Конечное число или `fallback` (NaN, ±Infinity, не-число). */
function finiteNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Доля сглаживания `smooth`: [0, 1]; NaN — 0 (мгновенно), ±∞ — край диапазона. */
function clampSmooth(value, fallback) {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    if (n === Infinity) return 1;
    if (n === -Infinity) return 0;
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

/** Угол в диапазон (-π, π]: yaw не должен расти бесконечно при вращении мышью. */
function wrapAngle(a) {
    if (a > Math.PI || a <= -Math.PI) {
        a -= Math.floor((a + Math.PI) / TAU) * TAU;   // [-π, π)
        if (a <= -Math.PI) a = Math.PI;               // (-π, π]
    }
    return a;
}

// ---------------------------------------------------------------------------
// §34. Отладочный оверлей камеры: ЧТО показывать.
//
// Состояние живёт здесь, а рисует его сама камера в конце _tick() — в фазе
// обновления кадра, до сборки батча. Рисовать «где-то ещё» нельзя: $.gfx.draw
// чистит очередь примитивов каждый кадр, поэтому оверлей обязан выпускать
// примитивы в том же кадре, который увидит игрок.
//
// По умолчанию всё выключено: у выключенного оверлея цена ноль, и кадр он не
// меняет (проверяется скриншотом до/после в tests/agent/camera_debug_test.py).
// ---------------------------------------------------------------------------
const CAM_DEBUG_FLAGS = ['limits', 'deadzone', 'target', 'lookahead', 'viewport', 'zones', 'text'];

const cam_debug = {
    on: false,
    limits: true,      // рамка $.camera.limits()
    deadzone: true,    // рамка мёртвой зоны
    target: true,      // крест цели и линия от камеры к ней
    lookahead: true,   // вектор выноса
    viewport: false,   // рамка видимого прямоугольника мира
    zones: true,       // границы активных зон из $.camera.zone()
    text: true,        // числовая строка (зум, сглаживание, тряска, вынос)
    last: null,        // факты последнего нарисованного кадра
};

const CAM_DEBUG_COLORS = {
    limits: '#57d3ff',
    deadzone: '#ffd166',
    target: '#ff5a4a',
    lead: '#ff9f43',
    viewport: '#8fd1ff',
    zone: '#b07cff',
    text: '#d8e2ee',
};

/** Примитивы оверлея: только через $.debug.draw (мировые координаты). */
function cameraDebugDraw() {
    const d = ctx && ctx.debug;
    return d && d.draw ? d.draw : null;
}

/** Число для подписи: без хвостов и без выдуманных знаков. */
function debugNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return String(Math.round(n * 100) / 100);
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

/**
 * Есть ли в этом билде движка нативный проход Re2D (`engine.re2d`)?
 *
 * Сборка с `-DR2D_ENABLE_RE2D=OFF` (2D-платформерная, см. xmake.lua)
 * не ставит ни `engine.re2d`, ни модули `$`, которые им пользуются. Проверка
 * одна на весь модуль: камера вида `'re2d'` тогда честно говорит «нет», а не
 * падает на `undefined.view`, а обычный 2D-вид работает как всегда.
 */
export function hasRe2d() {
    return !!(engine && engine.re2d && typeof engine.re2d.view === 'function');
}

/** Поставить нативный вид (engine.re2d.view) по состоянию камеры. */
export function applyRe2dView(c) {
    const v = re2dViewOf(c);
    // Выключенный Re2D — это не ошибка вызова: параметры вида всё равно нужны
    // вызывающему (кадр, туман), поэтому возвращаем их, просто никуда не шлём.
    // Сам проход вида регистрируется только вместе с модулем re2d.js.
    if (hasRe2d()) engine.re2d.view(v.x, v.y, v.eye, v.yaw, v.pitch, v.fov, v.fogFar, v.fogMin);
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
// Lookahead: камера платформера смотрит вперёд по направлению движения
//
// Скорость берётся из смещения цели за шаг (node.x - prev.x)/dt, а не из
// Box2D: так вынос работает и для узлов без тела (катсцены, кинематика), и
// при --fixed-dt остаётся детерминированным. Направление важнее модуля
// скорости: медленный шаг и бег дают один и тот же вынос, поэтому пороговая
// скорость маленькая (4 px/с), а сам вынос сглаживается — при развороте
// камера не «прыгает» из края в край.
// ---------------------------------------------------------------------------

const LEAD_MIN_SPEED = 4;      // px/с: медленнее — цель считается стоящей
const LEAD_TELEPORT = 128;     // px за шаг: это телепорт/респавн, а не движение

/** Текущий вынос камеры (геттер/сеттер для тестов и катсцен). */
function resetLead() { cam.lead_x = 0; cam.lead_y = 0; }

function stepLookahead(node, dt) {
    const prev = cam.prev_target;
    cam.prev_target = { x: node.x, y: node.y };
    if (!(cam.lookahead > 0) && !(cam.lookahead_y > 0)) { resetLead(); return; }
    if (!prev) return;                       // первый тик: направление ещё неизвестно
    const step = dt > 1e-6 ? dt : 1 / 60;
    const move_x = node.x - prev.x;
    const move_y = node.y - prev.y;
    if (Math.abs(move_x) > LEAD_TELEPORT || Math.abs(move_y) > LEAD_TELEPORT) {
        resetLead();                         // телепорт: вынос сбрасывается
        return;
    }
    const vx = move_x / step;
    const vy = move_y / step;
    const want_x = Math.abs(vx) > LEAD_MIN_SPEED ? Math.sign(vx) * cam.lookahead : 0;
    const want_y = Math.abs(vy) > LEAD_MIN_SPEED ? Math.sign(vy) * cam.lookahead_y : 0;
    // smooth — «доля, остающаяся за 1/60 с», как у сглаживания слежения:
    // 0 — вынос мгновенный, 1 — не двигается.
    const s = cam.lookahead_smooth;
    const k = s >= 1 ? 0 : (s <= 0 ? 1 : 1 - Math.pow(s, step * 60));
    cam.lead_x += (want_x - cam.lead_x) * k;
    cam.lead_y += (want_y - cam.lead_y) * k;
}

/** Мёртвая зона: число (квадрат) или [w, h]. false/null — выключить. */
function parseDeadzone(value) {
    if (value === false || value === null) return null;
    if (Array.isArray(value)) {
        return { w: Math.max(0, finiteNum(value[0], 0)), h: Math.max(0, finiteNum(value[1], 0)) };
    }
    if (typeof value === 'object') {
        return { w: Math.max(0, finiteNum(value.w, 0)), h: Math.max(0, finiteNum(value.h, 0)) };
    }
    const n = Math.max(0, finiteNum(value, 0));
    return { w: n, h: n };
}

/** Lookahead: число (обе оси) или { x, y }. false/null/0 — выключить. */
function parseLookahead(value) {
    if (value === false || value === null) return { x: 0, y: 0 };
    if (typeof value === 'object') {
        const x = Math.max(0, finiteNum(value.x, 0));
        return { x, y: Math.max(0, value.y === undefined ? x : finiteNum(value.y, 0)) };
    }
    const n = Math.max(0, finiteNum(value, 0));
    return { x: n, y: n };
}

/** Записать lookahead в состояние камеры; smooth необязателен. */
function applyLookahead(value, smooth) {
    const lead = parseLookahead(value);
    cam.lookahead = lead.x;
    cam.lookahead_y = lead.y;
    if (smooth !== undefined) {
        const s = Number(smooth);
        cam.lookahead_smooth = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : cam.lookahead_smooth;
    }
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

    // -----------------------------------------------------------------------
    // §19: зоны камеры и аренды. Это НАДСТРОЙКА над существующей камерой:
    // никакой второй камеры и второго transform не появляется — зона лишь
    // накладывает bounds/zoom/offset/follow и запоминает прежнюю конфигурацию,
    // чтобы вернуть её при выходе.
    // -----------------------------------------------------------------------
    const zone_defs = new Map();     // имя → данные зоны
    const zone_stack = [];           // активные зоны и аренды в порядке входа
    const saved_stack = [];          // снимки конфигурации до наложения
    let lease_seq = 1;

    function snapshotCam() {
        return {
            x: cam.x, y: cam.y, zoom: cam.zoom,
            limits: cam.limits ? { x: cam.limits.x, y: cam.limits.y, w: cam.limits.w, h: cam.limits.h } : null,
            deadzone: cam.deadzone ? { w: cam.deadzone.w, h: cam.deadzone.h } : null,
            offset: cam.offset ? { x: cam.offset.x, y: cam.offset.y } : null,
            target: cam.target, smooth: cam.smooth,
        };
    }

    function restoreCam(state) {
        if (!state) return;
        cam.x = state.x; cam.y = state.y; cam.zoom = state.zoom;
        cam.limits = state.limits ? Object.assign({}, state.limits) : null;
        cam.deadzone = state.deadzone ? Object.assign({}, state.deadzone) : null;
        cam.offset = state.offset ? Object.assign({}, state.offset) : cam.offset;
        cam.target = state.target; cam.smooth = state.smooth;
        clampToLimits();
    }

    /**
     * Разбор границ зоны. Принимает и `bounds:{x,y,w,h}`, и плоские
     * `x/y/w/h` — иначе одна из двух записей молча теряла бы границы
     * (именно так зона оставалась без limits).
     */
    function parseBounds(o) {
        if (o.bounds === null) return null;
        if (o.bounds !== undefined) {
            return {
                x: finiteNum(o.bounds.x, 0), y: finiteNum(o.bounds.y, 0),
                w: finiteNum(o.bounds.w, 0), h: finiteNum(o.bounds.h, 0),
            };
        }
        if (o.w !== undefined) {
            return { x: finiteNum(o.x, 0), y: finiteNum(o.y, 0),
                     w: finiteNum(o.w, 0), h: finiteNum(o.h, 0) };
        }
        return undefined;
    }

    /**
     * Полная запись данных зоны по имени.
     *
     * `zones.define(name, null)` (геттер) намеренно отдаёт КОРОТКОЕ описание, а
     * `acquire` нужна полная зона — иначе вход терял бы границы и данные.
     */
    function fullZone(nameOrZone) {
        if (!nameOrZone) return null;
        if (nameOrZone.data) return nameOrZone;              // уже полная запись
        return zone_defs.get(String(nameOrZone.name)) || null;
    }

    /** Наложить на камеру данные активной записи (зоны или аренды). */
    function applyEntry(entry) {
        if (!entry) return;
        const z = entry.data || {};
        if (z.bounds !== undefined) {
            cam.limits = z.bounds === null ? null : {
                x: finiteNum(z.bounds.x, 0), y: finiteNum(z.bounds.y, 0),
                w: finiteNum(z.bounds.w, 0), h: finiteNum(z.bounds.h, 0),
            };
        }
        if (z.zoom !== undefined) cam.zoom = Math.max(0.01, finiteNum(z.zoom, cam.zoom));
        if (z.offset !== undefined) {
            cam.offset = { x: finiteNum(z.offset[0], 0), y: finiteNum(z.offset[1], 0) };
        }
        if (z.follow !== undefined) {
            if (z.follow === null) { cam.target = null; }
            else {
                const wanted = typeof z.follow === 'string' ? query(z.follow)[0] : z.follow;
                cam.target = wanted ? (wanted.nodes ? wanted.nodes[0] : wanted) : null;
            }
        }
        if (z.smooth !== undefined) cam.smooth = clampSmooth(z.smooth, cam.smooth);
        if (z.deadzone !== undefined) cam.deadzone = parseDeadzone(z.deadzone);
        // Раньше lookahead зоны писался прямо в cam.lookahead: ось Y не
        // заполнялась, а мусор уходил в кадр. Теперь это общий разбор.
        if (z.lookahead !== undefined) applyLookahead(z.lookahead);
        if (z.at !== undefined) {
            cam.x = finiteNum(z.at[0], cam.x);
            cam.y = finiteNum(z.at[1], cam.y);
        }
        clampToLimits();
    }

    /**
     * Пересобрать состояние камеры из базы и активных записей.
     *
     * Каждая запись НАКЛАДЫВАЕТСЯ на предыдущее состояние, от младшего
     * приоритета к старшему: иначе зона, не задавшая поле, «съедала» бы
     * значение более приоритетной (именно так после аренды зум оставался
     * чужим). База — конфигурация на момент первого входа, поэтому выход из
     * всех зон возвращает ровно исходную камеру, а не «примерно».
     */
    function recompose() {
        if (!zone_stack.length) { restoreCam(saved_stack[0] || null); return; }
        restoreCam(saved_stack[0] || null);
        const ordered = zone_stack.slice().sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq));
        for (const e of ordered) applyEntry(e);
    }

    /** Порядок управления: сначала приоритет, потом порядок входа. */
    function controlOrder() {
        return zone_stack.slice().sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
    }

    const zones = {
        define(name, opts) {
            const key = String(name);
            if (opts === null || opts === undefined) {
                if (!zone_defs.has(key)) zone_defs.set(key, { name: key, priority: 0, seq: 0 });
                return zone_defs.get(key);
            }
            const o = opts || {};
            const data = {
                name: key,
                priority: Number(o.priority || 0),
                bounds: parseBounds(o),
                zoom: o.zoom,
                offset: o.offset,
                follow: o.follow,
                smooth: o.smooth,
                deadzone: o.deadzone,
                lookahead: o.lookahead,
                at: o.at,
                // В `data` кладём НОРМАЛИЗОВАННЫЕ поля, а не исходный объект:
                // запись вида `{x,y,w,h}` иначе теряла бы границы при входе в
                // зону (проверено тестом: limits оставался null).
                data: Object.assign({}, o, { bounds: parseBounds(o) }),
            };
            zone_defs.set(key, data);
            return { name: data.name, priority: data.priority, bounds: data.bounds || null };
        },
        info(name) {
            const z = zone_defs.get(String(name));
            if (!z) {
                // Промах по имени зоны — тем же правилом, что промах селектора
                // (task-47): сообщение один раз на имя, возврат прежний (null).
                missTarget('camera.zone', name, `зона "${name}" не найдена — верну null`);
                return null;
            }
            return {
                name: z.name, priority: z.priority, bounds: z.bounds || null,
                zoom: z.zoom === undefined ? null : z.zoom,
                follow: z.follow === undefined ? null : (typeof z.follow === 'string' ? z.follow : 'node'),
                active: zone_stack.some((e) => e.name === z.name && e.kind === 'zone'),
            };
        },
        list() {
            const out = [];
            for (const z of zone_defs.values()) {
                out.push({ name: z.name, priority: z.priority,
                           active: zone_stack.some((e) => e.name === z.name && e.kind === 'zone'),
                           bounds: z.bounds || null });
            }
            return out;
        },
        /** Зона, в границах которой находится узел (первая по приоритету). */
        zoneAt(node) {
            if (!node) return null;
            const found = [];
            for (const z of zone_defs.values()) {
                const b = z.bounds;
                if (!b) continue;
                if (node.x >= b.x && node.x <= b.x + b.w && node.y >= b.y && node.y <= b.y + b.h) found.push(z);
            }
            if (!found.length) return null;
            found.sort((a, b) => b.priority - a.priority);
            return found[0];
        },
        acquire(nameOrZone, opts) {
            const zone = fullZone(nameOrZone);
            const o = opts || {};
            const entry = {
                id: 'lease' + (lease_seq++),
                kind: zone ? 'zone' : 'lease',
                name: zone ? zone.name : (o.owner ? String(o.owner) : 'lease' + lease_seq),
                owner: o.owner === undefined ? (zone ? zone.name : null) : String(o.owner),
                priority: o.priority === undefined ? (zone ? zone.priority : 0) : Number(o.priority),
                seq: lease_seq,
                // Аренда — это данные зоны плюс её собственные поля: так один
                // механизм обслуживает и зоны уровня, и временные врезки.
                data: zone ? Object.assign({}, zone.data, o) : o,
                expires: Number(o.ms || 0) > 0 ? (Number(o.ms) / 1000) : 0,
            };
            if (!zone_stack.length) saved_stack[0] = snapshotCam();
            zone_stack.push(entry);
            recompose();
            return entry;
        },
        release(name) {
            if (name === undefined) return null;
            // Выход по имени зоны снимает последнюю запись этой зоны.
            for (let i = zone_stack.length - 1; i >= 0; i--) {
                if (zone_stack[i].name === String(name) || zone_stack[i].id === name) {
                    const entry = zone_stack.splice(i, 1)[0];
                    recompose();
                    return entry;
                }
            }
            return null;
        },
        drop(handle) {
            if (handle === undefined) {
                zone_stack.length = 0;
                recompose();
                const base = saved_stack[0] || null;
                saved_stack.length = 0;
                restoreCam(base);
                return true;
            }
            if (typeof handle === 'object' && handle && handle.id) return !!zones.release(handle.id);
            if (typeof handle === 'object' && handle && handle.owner) return !!zones.release(handle.owner);
            return !!zones.release(handle);
        },
        /** Пересчитать, кто управляет камерой: верхний по приоритету. */
        applyTop() { recompose(); },
        // Применить ТОЛЬКО если запись стала верхней по приоритету: вход в
        // младшую зону не должен перебивать уже активную старшую (иначе
        // «priority» ничего не решал бы, а решал бы порядок входа).
        applyIfTop() { recompose(); },
        apply(zone) { applyEntry(zone_stack.find((e) => e.name === zone.name) || zone); },
        describe() {
            const out = { zones: [], leases: [], active: null };
            for (const e of controlOrder()) {
                const row = { id: e.id, name: e.name, owner: e.owner, priority: e.priority, kind: e.kind };
                (e.kind === 'zone' ? out.zones : out.leases).push(row);
            }
            const top = controlOrder()[0];
            out.active = top ? {
                id: top.id, name: top.name, owner: top.owner,
                priority: top.priority, kind: top.kind,
            } : null;
            return out;
        },
        /** Тик: истечение аренд по времени. */
        tick(dt) {
            if (!zone_stack.length) return;
            let changed = false;
            for (let i = zone_stack.length - 1; i >= 0; i--) {
                const e = zone_stack[i];
                if (!e.expires) continue;
                e.expires -= dt;
                if (e.expires <= 0) { zone_stack.splice(i, 1); changed = true; }
            }
            if (changed) zones.applyTop();
        },
        _stack: zone_stack,
    };

    const camera = {
        at(x, y) {
            if (x === undefined) return { x: cam.x, y: cam.y };
            if (typeof x === 'object') {
                cam.x = finiteNum(x.x, cam.x);
                cam.y = finiteNum(x.y, cam.y);
            } else {
                cam.x = finiteNum(x, cam.x);
                cam.y = finiteNum(y, cam.y);
            }
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

        pos() { return { x: cam.x, y: cam.y }; },
        x() { return cam.x; },
        y() { return cam.y; },

        /**
         * Слежение за целью. `opts`:
         *   * `smooth` — «прилипание»: доля расстояния, которая остаётся за
         *     1/60 с (0 — мгновенно, 0.12 по умолчанию, 1 — не двигается);
         *   * `deadzone` — число (квадрат) или `[w, h]`: зона свободы вокруг
         *     цели; `false` — выключить;
         *   * `lookahead` — вынос вперёд по направлению движения, px (число
         *     или `{ x, y }`); 0/`false` — выключить;
         *   * `lookaheadSmooth` — сглаживание выноса, как `smooth` (0.9);
         *   * `offset` / `x`/`y` — смещение цели;
         *   * `zoom` — зум камеры.
         *
         *   $.camera.follow('#hero', { smooth: 0.12, deadzone: [40, 24], lookahead: 64 });
         */
        follow(selector, opts) {
            const o = opts || {};
            // Селектор и индекс храним как есть — узел может появиться позже,
            // а узел или обёртку принимаем объектом: resolveTarget умеет и то,
            // и другое. Раньше объект молча давал cam.target = null, и камера
            // не двигалась, хотя follow() возвращал себя для цепочки.
            const known = typeof selector === 'string' || typeof selector === 'number' ||
                (selector && (selector.tag || selector.nodes));
            cam.target = known ? selector : null;
            cam.offset = {
                x: o.offset ? finiteNum(o.offset[0], 0) : finiteNum(o.x, 0),
                y: o.offset ? finiteNum(o.offset[1], 0) : finiteNum(o.y, 0),
            };
            // smooth — доля в [0, 1]: больше единицы означало «остаётся больше
            // расстояния, чем есть», и камера расходилась (проверено тестом:
            // smooth=2 уводил её на десятки тысяч пикселей).
            cam.smooth = clampSmooth(o.smooth === undefined ? 0.12 : o.smooth, 0.12);
            // Раньше deadzone в follow() молча игнорировался: в доке пример был,
            // а камера его не читала. Теперь это обычная настройка слежения.
            if (o.deadzone !== undefined) cam.deadzone = parseDeadzone(o.deadzone);
            if (o.lookahead !== undefined) applyLookahead(o.lookahead, o.lookaheadSmooth);
            else if (o.lookaheadSmooth !== undefined) cam.lookahead_smooth = clampSmooth(o.lookaheadSmooth, cam.lookahead_smooth);
            if (o.zoom !== undefined) camera.zoom(o.zoom);
            cam.prev_target = null;          // смена цели — вынос считаем заново
            return camera;
        },

        unfollow() { cam.target = null; cam.smooth = 0; cam.prev_target = null; resetLead(); return camera; },

        /**
         * Вынос камеры вперёд: `.lookahead(px)` — обе оси, `.lookahead({ x, y })`
         * — по отдельности, `.lookahead(0)` — выключить. Второй аргумент —
         * сглаживание выноса (как `smooth`). Без аргументов — геттер
         * `{ x, y, smooth }`.
         */
        lookahead(value, smooth) {
            if (value === undefined) {
                return { x: cam.lookahead, y: cam.lookahead_y, smooth: cam.lookahead_smooth };
            }
            applyLookahead(value, smooth);
            return camera;
        },

        /** Узел, за которым следим сейчас (или null). */
        followed() {
            if (!cam.target) return null;
            const node = resolveTarget(cam.target, 'camera.followed');
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
                lookahead: { x: cam.lookahead, y: cam.lookahead_y, smooth: cam.lookahead_smooth },
            };
        },

        /** Вернуть камеру в снятое состояние (`snapshot()`). */
        restore(state) {
            if (!state) return camera;
            cam.x = finiteNum(state.x, cam.x); cam.y = finiteNum(state.y, cam.y);
            cam.zoom = Math.max(0.01, finiteNum(state.zoom, 1));
            cam.rotation = finiteNum(state.rotation, 0);
            // Поля вида: снимок из старой версии их не содержит — берём умолчания.
            cam.kind = state.kind && typeof state.kind === 'string' ? state.kind : KIND_2D;
            cam.yaw = finiteNum(state.yaw, 0);
            cam.pitch = finiteNum(state.pitch, 0);
            cam.eye = state.eye === undefined ? 48 : finiteNum(state.eye, 48);
            cam.fov = state.fov === undefined ? 70 * DEG : finiteNum(state.fov, 70 * DEG);
            cam.fog_far = finiteNum(state.fogFar, 0);
            cam.fog_min = state.fogMin === undefined ? 0.25 : finiteNum(state.fogMin, 0.25);
            cam.target = state.target || null;
            cam.offset.x = state.offset ? finiteNum(state.offset.x, 0) : 0;
            cam.offset.y = state.offset ? finiteNum(state.offset.y, 0) : 0;
            cam.smooth = clampSmooth(state.smooth === undefined ? 0 : state.smooth, 0);
            cam.limits = state.limits ? Object.assign({}, state.limits) : null;
            cam.deadzone = state.deadzone ? Object.assign({}, state.deadzone) : null;
            // Снимок из старой версии выноса не содержит — это не ошибка:
            // камера возвращается без lookahead, как и была до его включения.
            const lead = state.lookahead;
            if (lead) {
                cam.lookahead = Math.max(0, finiteNum(lead.x, 0));
                cam.lookahead_y = Math.max(0, finiteNum(lead.y, 0));
                cam.lookahead_smooth = lead.smooth === undefined
                    ? cam.lookahead_smooth : clampSmooth(lead.smooth, cam.lookahead_smooth);
            }
            cam.prev_target = null;
            resetLead();
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
                cam.yaw = wrapAngle(finiteNum(value, 0));
                return camera;
            }
            if (value === undefined) return cam.rotation;
            cam.rotation = finiteNum(value, 0);
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
            const kind = normalizeKind(value);
            // Вид 're2d' — это нативный проход (engine.re2d). В сборке
            // платформера (-DR2D_ENABLE_RE2D=OFF) прохода нет, и включать его
            // нельзя: кадр пошёл бы по ветке, которой нечем работать, и упал бы
            // на первом же engine.re2d.* внутри отрисовщиков. Отказываем здесь
            // и называем причину — это дешевле, чем искать её в чужом стеке.
            if (kind === KIND_RE2D && !hasRe2d()) {
                throw new TypeError(
                    "камера: вид 're2d' недоступен — движок собран без RE2D " +
                    '(R2D_ENABLE_RE2D=OFF, см. docs/BUILD.md); доступен обычный 2D: .kind(null)');
            }
            cam.kind = kind;
            return camera;
        },

        /** Куда смотрим, градусы (в Re2D это же поле читает rotation() в радианах). */
        yaw(value) {
            if (value === undefined) return cam.yaw / DEG;
            cam.yaw = wrapAngle(finiteNum(value, 0) * DEG);
            return camera;
        },

        /** Наклон вверх-вниз, градусы; зажат в ±85°. */
        pitch(value) {
            if (value === undefined) return cam.pitch / DEG;
            cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, finiteNum(value, 0) * DEG));
            return camera;
        },

        /** Высота глаз над полом (пиксели мира). */
        eye(value) {
            if (value === undefined) return cam.eye;
            cam.eye = finiteNum(value, 0);
            return camera;
        },

        /** Вертикальный угол обзора, градусы (до зума). */
        fov(value) {
            if (value === undefined) return cam.fov / DEG;
            cam.fov = Math.max(5, Math.min(170, finiteNum(value, 70))) * DEG;
            return camera;
        },

        /** Затемнение с расстоянием: `fog(far, min)`; `fog(0)` выключает. */
        fog(far, min) {
            if (far === undefined) return { far: cam.fog_far, min: cam.fog_min };
            cam.fog_far = Math.max(0, finiteNum(far, 0));
            if (min !== undefined) cam.fog_min = Math.max(0, Math.min(1, finiteNum(min, 0)));
            return camera;
        },

        /**
         * Повернуть взгляд на сдвиг мыши в пикселях: вправо — поворот направо,
         * вверх — взгляд вверх. Работает и без `mouseLook`, например из
         * геймпада или теста.
         */
        look(dx, dy) {
            cam.yaw = wrapAngle(cam.yaw + finiteNum(dx, 0) * cam.look_sens);
            cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch - finiteNum(dy, 0) * cam.look_sens));
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
                // Слежение платформера: цель, сглаживание, мёртвая зона, вынос.
                target: cam.target !== null, smooth: cam.smooth,
                deadzone: cam.deadzone ? { w: cam.deadzone.w, h: cam.deadzone.h } : null,
                lookahead: { x: cam.lookahead, y: cam.lookahead_y, leadX: cam.lead_x, leadY: cam.lead_y },
                limits: cam.limits ? { x: cam.limits.x, y: cam.limits.y, w: cam.limits.w, h: cam.limits.h } : null,
            };
        },

        zoom(value) {
            if (value === undefined) return cam.zoom;
            // Только конечное число: zoom(NaN) раньше уносил в NaN половину
            // кадра, отсечение и worldToScreen. Мусор — «зум не меняется».
            const z = finiteNum(value, cam.zoom);
            cam.zoom = Math.max(0.01, z);
            clampToLimits();
            return camera;
        },

        zoomTo(value, ms) {
            const from = cam.zoom;
            const to = finiteNum(value, from);
            return animate(ms, (p) => { cam.zoom = Math.max(0.01, from + (to - from) * p); });
        },

        panTo(x, y, ms) {
            const fx = cam.x, fy = cam.y;
            const tx = finiteNum(x, fx), ty = finiteNum(y, fy);
            return animate(ms, (p) => { cam.x = fx + (tx - fx) * p; cam.y = fy + (ty - fy) * p; clampToLimits(); });
        },

        // --- §19: зоны камеры и аренда управления ----------------------------

        /**
         * Зона камеры: переиспользуемая настройка для участка уровня.
         *
         * ```js
         * $.camera.zone('well', { x: 0, y: 0, w: 800, h: 2000, zoom: 0.9,
         *                         follow: '#hero', offset: [0, 40] });
         * $.camera.enter('well');      // применить
         * $.camera.leave('well');      // вернуть прежнюю конфигурацию
         * $.camera.enter();            // зона, в которой цель находится сейчас
         * ```
         *
         * Зона — это ДАННЫЕ, а не вторая камера: она накладывает границы, зум,
         * смещение и политику следования на существующую камеру. Одновременно
         * активных зон может быть несколько — какая победит, решают `priority`
         * и порядок входа, а не порядок объявления в коде.
         */
        zone(name, opts) {
            if (name === undefined) return zones.list();
            if (opts === undefined) return zones.info(name);
            zones.define(name, opts);
            // Возвращаем true, а не камеру: `$.camera.zone()` без аргументов —
            // геттер, и если бы определение возвращало камеру, JSON.stringify
            // тянул бы весь внутренний стейт камеры в отчёты и логи.
            return true;
        },

        /** Войти в зону (или в зону, где сейчас находится цель). */
        enter(name, opts) {
            // Без имени — это «перейти в комнату, где цель»: прежние зоны
            // снимаются, иначе в стеке осталась бы прошлая комната и приоритет
            // мешал бы новой (вход без имени обязан быть переходом).
            if (name === undefined) {
                for (let i = zones._stack.length - 1; i >= 0; i--) {
                    if (zones._stack[i].kind === 'zone') zones.release(zones._stack[i].id);
                }
            }
            // Позицию берём у ЦЕЛИ камеры, а если цели нет — у игрока/героя:
            // у только что созданной сцены follow может быть ещё не задан.
            const where = cam.target || query('#hero')[0] || query('player')[0] || null;
            const zone = name === undefined ? zones.zoneAt(where) : zones.define(name, null);
            if (!zone) return false;
            const lease = zones.acquire(zone, opts);
            zones.applyIfTop(lease);
            return lease ? lease.id : false;
        },

        /** Выйти из зоны: вернуть прежнюю конфигурацию. */
        leave(name) {
            const zone = zones.release(name);
            if (!zone) return false;
            zones.applyTop();
            return true;
        },

        /**
         * Временная аренда камеры: cutscene, добивание, диалог.
         *
         * ```js
         * const lease = $.camera.lease({ owner: 'cutscene', priority: 10,
         *                                zoom: 1.4, offset: [0, -20], ms: 1200 });
         * $.camera.release(lease);     // вернуть прежнюю конфигурацию
         * ```
         *
         * Аренда с более высоким приоритетом перебивает зону; при её снятии
         * камера возвращается ровно туда, где была, — а не «примерно».
         */
        lease(opts) {
            return zones.acquire(null, opts || {});
        },

        /** Снять аренду по id, имени владельца или все аренды владельца. */
        release(lease) { return zones.drop(lease); },

        /** Что сейчас управляет камерой: активные зоны и аренды по приоритету. */
        control() { return zones.describe(); },

        /** Тряска: амплитуда в пикселях, длительность в миллисекундах.
         *  `shake(0, 0)` — явный «стоп»: ноль амплитуды гасит тряску, а не
         *  превращается в значение по умолчанию (раньше `|| 4` делал из нуля
         *  полноценную тряску 4 px / 250 мс, и остановить её публично было
         *  нечем). */
        shake(intensity, ms) {
            // Амплитуда — конечное число > 0. NaN/Infinity/отрицательное — это
            // «стоп», а не NaN в shake_x: раньше shake(NaN) делал cam.shake_amp
            // NaN, и сдвиг кадра (а с ним worldToScreen) становился NaN.
            const amp = intensity === undefined ? 4 : finiteNum(intensity, 0);
            if (!(amp > 0)) {
                cam.shake_amp = 0;
                cam.shake_total = cam.shake_t = 0;
                cam.shake_x = cam.shake_y = 0;
                return camera;
            }
            const dur = ms === undefined ? 250 : finiteNum(ms, 250);
            cam.shake_amp = Math.max(cam.shake_amp, amp);
            cam.shake_total = cam.shake_t = Math.max(0, dur) / 1000;
            return camera;
        },

        /**
         * Границы камеры: `limits(x, y, w, h)`; `limits(null)` — снять.
         * Без аргументов — геттер `{ x, y, w, h }` или `null`.
         */
        limits(x, y, w, h) {
            if (x === undefined) return cam.limits ? { x: cam.limits.x, y: cam.limits.y, w: cam.limits.w, h: cam.limits.h } : null;
            // Не-конечные числа читаются как 0: иначе clampToLimits() разносил
            // NaN по обеим координатам камеры.
            cam.limits = (x === null) ? null
                : { x: finiteNum(x, 0), y: finiteNum(y, 0), w: finiteNum(w, 0), h: finiteNum(h, 0) };
            clampToLimits();
            return camera;
        },

        /**
         * Мёртвая зона: `deadzone(w, h)`, `deadzone(n)` — квадрат,
         * `deadzone(false)` — выключить. Без аргументов — геттер `{ w, h }` или
         * `null`.
         */
        deadzone(w, h) {
            if (w === undefined) return cam.deadzone ? { w: cam.deadzone.w, h: cam.deadzone.h } : null;
            if (w === null || w === false) { cam.deadzone = null; return camera; }
            const n = Math.max(0, finiteNum(w, 0));
            cam.deadzone = { w: n, h: h === undefined ? n : Math.max(0, finiteNum(h, 0)) };
            return camera;
        },

        /**
         * §34. Отладочный оверлей камеры: мёртвая зона, границы, цель,
         * вынос, текущий зум и якорь. По умолчанию ВЫКЛЮЧЕН — включённый
         * оверлей рисует примитивы поверх кадра.
         *
         * ```js
         * $.camera.debug(true);                    // всё, кроме рамки вида
         * $.camera.debug({ viewport: true });      // включить и добавить рамку вида
         * $.camera.debug(false);                   // выключить
         * const facts = $.camera.debug();          // факты последнего кадра
         * ```
         *
         * Без аргументов возвращает ФАКТЫ камеры (и что именно нарисовано),
         * а не саму камеру: по ним панель DevTools и тест сверяют оверлей с
         * `$.camera.limits()` / `$.camera.deadzone()` / `$.camera.control()`.
         * Ничего неизвестного оверлей не рисует: нет границ — нет рамки.
         */
        debug(opts) {
            if (opts === undefined) return camDebugFacts();
            if (opts === false || opts === null) {
                cam_debug.on = false;
            } else if (opts === true) {
                cam_debug.on = true;
            } else if (typeof opts === 'object') {
                // Объект включает оверлей, если явно не сказано `on: false` —
                // как $.gfx.light.map({…}): «покажи границы» без отдельного
                // true было бы сюрпризом.
                cam_debug.on = opts.on === undefined ? true : opts.on !== false;
                for (const key of CAM_DEBUG_FLAGS) {
                    if (opts[key] !== undefined) cam_debug[key] = opts[key] !== false;
                }
            } else {
                ctx.log('$.camera.debug: ожидается true/false или { on, limits, deadzone, target, lookahead, viewport, zones, text }');
            }
            if (!cam_debug.on) cam_debug.last = null;
            return camDebugFacts();
        },

        worldToScreen(p) {
            const pt = toPoint(p, 'camera.worldToScreen');
            if (cam.kind === KIND_RE2D) return re2dWorldToScreen(pt, p);
            const state = { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation };
            const out = frameWorldToScreen(state, pt.x, pt.y, engine.width, engine.height);
            // Тряска — поверх всего: она сдвигает кадр, а не мир.
            out.x += cam.shake_x;
            out.y += cam.shake_y;
            return out;
        },

        screenToWorld(p) {
            const pt = toPoint(p, 'camera.screenToWorld');
            if (cam.kind === KIND_RE2D) {
                // Пиксель → точка на полу (или на высоте p.z): луч из глаз.
                applyRe2dView(cameraTransform());
                // Сборка без RE2D: восстановить точку нечем — честный null,
                // как и при промахе луча (см. docs/highlevel/camera.md).
                if (!hasRe2d() || typeof engine.re2d.unproject !== 'function') return null;
                const hit = engine.re2d.unproject(pt.x, pt.y, p && typeof p === 'object' && p.z ? Number(p.z) : 0);
                return hit ? { x: hit[0], y: hit[1] } : null;
            }
            const state = { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation };
            return frameScreenToWorld(state, pt.x - cam.shake_x, pt.y - cam.shake_y,
                                      engine.width, engine.height);
        },

        /**
         * Видно ли то, что передали (узел, селектор или точка). `margin` —
         * запас в пикселях вокруг кадра (по умолчанию 64): рисуйте только то,
         * что попало, с запасом на ход объекта за кадр.
         */
        isOnScreen(what, opts) {
            // H8: второй аргумент — число (запас в пикселях, прежнее поведение)
            // ИЛИ прямоугольник ЗОНЫ вокруг узла: { w, h, dx, dy } (смещение от
            // узла) либо { x, y, w, h } (абсолютный центр). Раньше объект молча
            // игнорировался: `isOnScreen(node, {w:8000,h:8000})` отвечал как
            // `isOnScreen(node)`, и «зона пробуждения» не измерялась.
            const zone = (opts && typeof opts === 'object') ? opts : null;
            const margin = zone ? undefined : opts;
            const pad = margin === undefined ? 64 : Math.max(0, Number(margin) || 0);
            const zone_w = zone ? Math.abs(Number(zone.w) || 0) / 2 : 0;
            const zone_h = zone ? Math.abs(Number(zone.h) || 0) / 2 : 0;
            const zoneOf = (x, y) => ({
                x: zone && zone.x !== undefined ? Number(zone.x) : x + (zone ? Number(zone.dx) || 0 : 0),
                y: zone && zone.y !== undefined ? Number(zone.y) : y + (zone ? Number(zone.dy) || 0 : 0),
            });
            if (cam.kind === KIND_RE2D) {
                // Зона и здесь работает: смещаем точку на dx/dy, а w/h дают запас.
                if (typeof what === 'string') return query(what).some((n) => camera.isOnScreen(n, opts));
                if (typeof what === 'object' && what && what.tag && what.attrs.ui) return true;
                const base = toPoint(what, 'camera.isOnScreen');
                const shifted = zoneOf(base.x, base.y);
                const s = re2dWorldToScreen(shifted, what);
                const pad_x = pad + zone_w;
                const pad_y = pad + zone_h;
                return s.visible && s.x >= -pad_x && s.x <= engine.width + pad_x
                    && s.y >= -pad_y && s.y <= engine.height + pad_y;
            }
            const half_w = engine.width / (2 * cam.zoom) + pad;
            const half_h = engine.height / (2 * cam.zoom) + pad;
            if (typeof what === 'string') return query(what).some((n) => camera.isOnScreen(n, opts));
            if (typeof what === 'object' && what && what.tag) {
                if (what.attrs.ui) return true;
                const c = zoneOf(what.x, what.y);
                return Math.abs(c.x - cam.x) <= half_w + (zone ? zone_w : what.w / 2) &&
                       Math.abs(c.y - cam.y) <= half_h + (zone ? zone_h : what.h / 2);
            }
            const pt = toPoint(what, 'camera.isOnScreen');
            const c = zoneOf(pt.x, pt.y);
            return Math.abs(c.x - cam.x) <= half_w + zone_w &&
                   Math.abs(c.y - cam.y) <= half_h + zone_h;
        },

        /** Видимый прямоугольник мира — для отсечения и спавна. */
        viewport() {
            const half_w = engine.width / (2 * cam.zoom);
            const half_h = engine.height / (2 * cam.zoom);
            return { x: cam.x - half_w, y: cam.y - half_h, w: half_w * 2, h: half_h * 2 };
        },

        /** Внутреннее: вызывается из $.time каждый кадр. */
        _tick(dt) {
            // §19: аренды камеры истекают по времени и возвращают прежнюю
            // конфигурацию сами — cutscene не обязана помнить о release.
            zones.tick(dt);
            if (cam.kind === KIND_RE2D && cam.look_on && $.input) {
                // Взгляд мышью: сдвиг за кадр (в записи/реплее он тоже есть).
                const m = $.input.mouseDelta();
                if (m && (m.x || m.y)) camera.look(m.x, m.y);
            }
            if (cam.target) {
                const node = resolveTarget(cam.target, 'camera.follow', true);
                if (!node) {
                    // Цель ещё не создана (селектор разрешается лениво):
                    // прошлую позицию не храним, иначе первый кадр после
                    // появления узла выглядел бы телепортом.
                    cam.prev_target = null;
                    resetLead();
                } else {
                    if (cam.kind === KIND_RE2D) {
                        // Глаза не «плывут» за телом: от первого лица слежение
                        // мгновенное, а вынос кадра не нужен.
                        cam.x = node.x + cam.offset.x;
                        cam.y = node.y + cam.offset.y;
                        cam.prev_target = { x: node.x, y: node.y };
                        resetLead();
                    } else {
                        stepLookahead(node, dt);
                        // Куда камера ХОЧЕТ попасть: цель + смещение + вынос.
                        const tx = node.x + cam.offset.x + cam.lead_x;
                        const ty = node.y + cam.offset.y + cam.lead_y;
                        // Мёртвая зона задаёт ЦЕЛЬ движения, а не способ: пока
                        // цель внутри зоны, цель движения — текущее положение
                        // (камера стоит), за зоной — край зоны. Сглаживание
                        // применяется уже к этой цели, поэтому deadzone и
                        // smooth работают вместе, а не исключают друг друга.
                        let gx = tx, gy = ty;
                        if (cam.deadzone) {
                            const dx = tx - cam.x, dy = ty - cam.y;
                            const hw = cam.deadzone.w / 2, hh = cam.deadzone.h / 2;
                            gx = Math.abs(dx) > hw ? cam.x + dx - Math.sign(dx) * hw : cam.x;
                            gy = Math.abs(dy) > hh ? cam.y + dy - Math.sign(dy) * hh : cam.y;
                        }
                        if (cam.smooth > 0) {
                            const k = 1 - Math.pow(cam.smooth, dt * 60);
                            cam.x += (gx - cam.x) * k;
                            cam.y += (gy - cam.y) * k;
                        } else {
                            cam.x = gx;
                            cam.y = gy;
                        }
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
            if (cam_debug.on) drawCameraDebug();
            else cam_debug.last = null;
        },

        _state: cam,
    };

    // -----------------------------------------------------------------------
    // §34. Рисование оверлея и факты о нём.
    //
    // Факты — тот же источник, что и картинка: и то и другое считается из
    // cam/зоны здесь, поэтому «нарисовано» и «показано панели» не могут
    // разойтись. Всё, чего камера не знает (границ нет, цели нет), в фактах
    // стоит null и в кадр не попадает.
    // -----------------------------------------------------------------------

    /** Ярлык цели: селектор как есть, узел — по стабильному nid. */
    function targetLabel() {
        if (cam.target === null || cam.target === undefined) return null;
        if (typeof cam.target === 'string') return cam.target;
        if (typeof cam.target === 'number') return 'nid' + cam.target;
        const node = resolveTarget(cam.target);
        return node ? 'nid' + node.nid : null;
    }

    /** Активные зоны и аренды с границами, которые у них реально есть. */
    function controlAreas() {
        const ctl = zones.describe();
        return ctl.zones.concat(ctl.leases).map((row) => {
            const info = row.kind === 'zone' ? zones.info(row.name) : null;
            return {
                id: row.id, name: row.name, owner: row.owner,
                priority: row.priority, kind: row.kind,
                bounds: info && info.bounds ? {
                    x: info.bounds.x, y: info.bounds.y, w: info.bounds.w, h: info.bounds.h,
                } : null,
            };
        });
    }

    /** Факты камеры для панели/теста: значения, а не ссылки на узлы. */
    function camDebugFacts() {
        const node = cam.target ? resolveTarget(cam.target) : null;
        return {
            on: cam_debug.on,
            flags: CAM_DEBUG_FLAGS.reduce((acc, key) => { acc[key] = cam_debug[key]; return acc; }, {}),
            kind: cam.kind,
            target: targetLabel(),
            targetPos: node ? { x: node.x, y: node.y } : null,
            actual: { x: cam.x, y: cam.y },
            desired: node
                ? { x: node.x + cam.offset.x + cam.lead_x, y: node.y + cam.offset.y + cam.lead_y }
                : null,
            offset: { x: cam.offset.x, y: cam.offset.y },
            lookahead: {
                x: cam.lookahead, y: cam.lookahead_y,
                leadX: cam.lead_x, leadY: cam.lead_y, smooth: cam.lookahead_smooth,
            },
            smooth: cam.smooth,
            zoom: cam.zoom,
            rotation: cam.rotation,
            shake: { x: cam.shake_x, y: cam.shake_y },
            deadzone: cam.deadzone ? { w: cam.deadzone.w, h: cam.deadzone.h } : null,
            limits: cam.limits
                ? { x: cam.limits.x, y: cam.limits.y, w: cam.limits.w, h: cam.limits.h }
                : null,
            viewport: camera.viewport(),
            areas: controlAreas(),
            active: zones.describe().active,
            // Что именно выпущено в кадр: null — оверлей выключен либо
            // рисовать нечем ($.debug.draw недоступен).
            drawn: cam_debug.last ? Object.assign({}, cam_debug.last) : null,
        };
    }

    /**
     * Оверлей кадра. Рисуем ровно те факты, что перечислены в §34: границы,
     * мёртвую зону, цель/вынос, при желании — рамку вида и активные зоны.
     * RE2D-камера сюда не попадает: у неё нет ни мёртвой зоны, ни границ
     * 2D-вида, и рисовать «по аналогии» значило бы выдумывать.
     *
     * Рамки — четырьмя отрезками, а не `rect`: `$.debug.draw.rect` заливает
     * прямоугольник, и залитые границы камеры закрыли бы весь кадр.
     */
    function drawCameraDebug() {
        const d = cameraDebugDraw();
        if (!d) { cam_debug.last = null; return; }
        const marks = { rects: 0, lines: 0, texts: 0, reason: null, boxes: [] };
        if (cam.kind !== KIND_2D) {
            marks.reason = 're2d';
            cam_debug.last = marks;
            return;
        }
        const line = (a, b, color, width) => { d.line(a, b, color, width); marks.lines++; };
        /** Рамка прямоугольника: 4 отрезка, чтобы не заливать кадр. */
        const box = (x0, y0, x1, y1, color, width) => {
            const a = { x: x0, y: y0 }, b = { x: x1, y: y1 };
            const c = { x: x1, y: y0 }, e = { x: x0, y: y1 };
            line(a, c, color, width); line(c, b, color, width);
            line(b, e, color, width); line(e, a, color, width);
            marks.rects++;
            marks.boxes.push([x0, y0, x1, y1]);
        };
        const node = cam.target ? resolveTarget(cam.target) : null;

        if (cam_debug.limits && cam.limits) {
            box(cam.limits.x, cam.limits.y, cam.limits.x + cam.limits.w, cam.limits.y + cam.limits.h,
                CAM_DEBUG_COLORS.limits, 2);
        }
        if (cam_debug.viewport) {
            const v = camera.viewport();
            box(v.x, v.y, v.x + v.w, v.y + v.h, CAM_DEBUG_COLORS.viewport, 1);
        }
        if (cam_debug.deadzone && cam.deadzone) {
            const hw = cam.deadzone.w / 2, hh = cam.deadzone.h / 2;
            box(cam.x - hw, cam.y - hh, cam.x + hw, cam.y + hh, CAM_DEBUG_COLORS.deadzone, 2);
        }
        // Границы активных зон: только у тех, чьи границы объявлены данными.
        if (cam_debug.zones) {
            for (const area of controlAreas()) {
                if (!area.bounds) continue;
                box(area.bounds.x, area.bounds.y,
                    area.bounds.x + area.bounds.w, area.bounds.y + area.bounds.h,
                    CAM_DEBUG_COLORS.zone, 2);
            }
        }
        if (cam_debug.target && node) {
            line({ x: node.x - 8, y: node.y }, { x: node.x + 8, y: node.y }, CAM_DEBUG_COLORS.target, 2);
            line({ x: node.x, y: node.y - 8 }, { x: node.x, y: node.y + 8 }, CAM_DEBUG_COLORS.target, 2);
            // Где камера на самом деле и куда её тянет цель (с выносом).
            line({ x: cam.x, y: cam.y }, { x: node.x, y: node.y }, CAM_DEBUG_COLORS.target, 1);
            if (cam_debug.lookahead) {
                line({ x: node.x, y: node.y },
                     { x: node.x + cam.offset.x + cam.lead_x, y: node.y + cam.offset.y + cam.lead_y },
                     CAM_DEBUG_COLORS.lead, 2);
            }
        }
        if (cam_debug.text) {
            const lines = [
                `камера ${debugNum(cam.x)},${debugNum(cam.y)}  зум ${debugNum(cam.zoom)}`
                    + `  сглаживание ${debugNum(cam.smooth)}`,
            ];
            if (cam.limits) {
                lines.push(`границы ${debugNum(cam.limits.x)},${debugNum(cam.limits.y)}`
                    + ` ${debugNum(cam.limits.w)}x${debugNum(cam.limits.h)}`);
            }
            if (cam.deadzone) {
                lines.push(`мёртвая зона ${debugNum(cam.deadzone.w)}x${debugNum(cam.deadzone.h)}`);
            }
            if (cam.lookahead > 0 || cam.lookahead_y > 0) {
                lines.push(`вынос ${debugNum(cam.lead_x)},${debugNum(cam.lead_y)}`
                    + ` (макс ${debugNum(cam.lookahead)},${debugNum(cam.lookahead_y)})`);
            }
            if (cam.shake_x || cam.shake_y) {
                lines.push(`тряска ${debugNum(cam.shake_x)},${debugNum(cam.shake_y)}`);
            }
            if (targetLabel()) lines.push(`цель ${targetLabel()}`);
            // Якорь подписи — угол границ (если они есть), иначе центр вида:
            // подпись не уезжает за кадр вместе с целью.
            const anchor = cam.limits
                ? { x: cam.limits.x + 6, y: cam.limits.y + 18 }
                : { x: cam.x - engine.width / (2 * cam.zoom) + 6,
                    y: cam.y - engine.height / (2 * cam.zoom) + 18 };
            for (let i = 0; i < lines.length; i++) {
                d.text(lines[i], { x: anchor.x, y: anchor.y + i * 16 }, CAM_DEBUG_COLORS.text, 13);
                marks.texts++;
            }
        }
        cam_debug.last = marks;
    }

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
    // Сборка без RE2D: нативной проекции нет. Возвращаем «не видно», а не
    // координаты обычной 2D-проекции: вызывающий код проверяет visible, и такая
    // точка не должна попасть на экран как настоящая.
    if (!hasRe2d() || typeof engine.re2d.project !== 'function') {
        return { x: pt.x, y: pt.y, scale: 1, depth: z, visible: false };
    }
    const out = new Float32Array(4);
    const visible = engine.re2d.project(new Float32Array([pt.x, pt.y, z]), out) > 0;
    return { x: out[0], y: out[1], scale: out[3], depth: out[2], visible };
}

/**
 * Промах цели — ОДИН раз на пару «место + цель» (правило task-47: цель-селектор
 * либо разрешается, либо промах слышен; повторные промахи журнал не заливают).
 *
 * Для слежения это особенно важно: `follow('#hero')` хранит селектор как есть,
 * а разрешает его КАЖДЫЙ кадр — узел может появиться позже (осознанная
 * ленивость). Поэтому у ленивой дороги своя формулировка: «пока не найден,
 * жду», а не «ошибка».
 */
const missed_targets = new Set();

function missTarget(where, what, message) {
    // Ключ — СЫРАЯ цель (селектор/имя): targetResolved() снимает тот же ключ.
    const key = where + ' ' + what;
    if (missed_targets.has(key)) return;
    missed_targets.add(key);
    ctx.log(`$.${where}: ${message}`);
}

function targetResolved(where, what) {
    missed_targets.delete(where + ' ' + what);
}

function resolveTarget(target, where, lazy) {
    if (typeof target === 'string') {
        const node = query(target)[0] || null;
        if (node) {
            if (where) targetResolved(where, target);
            return node;
        }
        if (where) {
            missTarget(where, target, lazy
                ? `цель "${target}" пока не найдена — жду появления узла`
                : `селектор "${target}" ни к чему не подошёл — верну null`);
        }
        return null;
    }
    if (typeof target === 'number') return ctx.nodes[target] || null;
    if (target && target.nodes) return target.nodes[0] || null;
    if (target && target.tag) return target;
    return null;
}

function toPoint(p, where) {
    if (p === undefined || p === null) return { x: 0, y: 0 };
    if (typeof p === 'string') {
        const n = query(p)[0];
        if (n) {
            if (where) targetResolved(where, p);
            return { x: n.x, y: n.y };
        }
        if (where) {
            missTarget(where, p, `селектор "${p}" ни к чему не подошёл — беру (0, 0)`);
        }
        return { x: 0, y: 0 };
    }
    if (typeof p === 'object' && p.nodes) {
        const n = p.nodes[0];
        if (!n && where) missTarget(where, '(пустая обёртка)', 'обёртка пуста — беру (0, 0)');
        return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    }
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
