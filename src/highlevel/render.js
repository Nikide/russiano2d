// ===========================================================================
// Графика: $.gfx — пакет спрайтов, камера, тексты, примитивы, отладочный слой.
//
// Весь кадр собирается здесь за один проход:
//   1. сцена — узлы мира, отсортированные по слою/глубине;
//   2. круги и свечения — треугольниками (у спрайта нет формы);
//   3. интерфейс — узлы <ui.*> в координатах окна;
//   4. примитивы $.gfx.draw.* — поверх всего;
//   5. текст — через engine.drawText (ImGui background draw list).
//
// Никаких вызовов «на спрайт»: пакет наполняется в типизированные массивы и
// отдаётся в C одним submitSprites().
// ===========================================================================

import { ctx, wrap, packColor, withAlpha, fxRandom } from './core.js';
import { cameraTransform } from './camera.js';

const MAX_SPRITES = 16384;
const MAX_TRIS = 8192;

let xf = null;          // Float32Array(max * 6)
let col = null;         // Uint32Array(max)
let blend = null;       // Uint8Array(max) — режим смешивания каждого спрайта
let count = 0;

// Порядок обязан совпадать с порядком конвейеров в render.c.
const BLEND_NAMES = ['alpha', 'add', 'multiply', 'none'];
const BLEND_IDS = new Map(BLEND_NAMES.map((n, i) => [n, i]));
function blendId(name) {
    const id = BLEND_IDS.get(name);
    return id === undefined ? 0 : id;
}

// Режим по умолчанию для всех спрайтов кадра: его задаёт $.blend(...)
// (модуль viewport.js). Узел может переопределить его через .blend().
let default_blend = 'alpha';
let tri = null;         // Float32Array(max * 3 * 6)
let tri_count = 0;      // число вершин (кратно 3)
let tri_blend = null;   // Uint8Array(max) — режим смешивания каждого треугольника
let tri_blend_cur = 0;  // режим, который получит следующий треугольник

// Мировой слой. Батч движка принимает ЭКРАННЫЕ координаты (узлы и частицы
// переводят их сами через камеру), но VFX и $.gfx.draw.* работают в мировых.
// Пока view включён, push.* переводит world → screen сам — иначе лента,
// вспышка или трассер уезжают в угол экрана на расстояние камеры.
let view = null;
function setView(cam) {
    view = cam
        ? { x: cam.x, y: cam.y, zoom: cam.zoom || 1,
            cx: (cam.w !== undefined ? cam.w : engine.width) / 2,
            cy: (cam.h !== undefined ? cam.h : engine.height) / 2,
            sx: cam.shake_x || 0, sy: cam.shake_y || 0 }
        : null;
}
function viewX(x) { return view ? (x - view.x) * view.zoom + view.cx + view.sx : x; }
function viewY(y) { return view ? (y - view.y) * view.zoom + view.cy + view.sy : y; }
function viewScale(v) { return view ? v * view.zoom : v; }

// Отдельный односпрайтовый пакет для затемнения перехода между сценами:
// так он не занимает слот в общем буфере кадра.
const overlay_xf = new Float32Array(6);
const overlay_col = new Uint32Array(1);

const draw_calls = [];  // $.gfx.draw.* — чистятся каждый кадр

// ---------------------------------------------------------------------------
// Реестр отрисовщиков для тегов, которые заводят модули подсистем.
//
// Ядро не знает про <tilemap>, <particles> и подобные теги: каждый модуль
// регистрирует свой отрисовщик сам (registerNodeRenderer) и работает через
// публичный батч $.gfx.push — так новые теги не требуют правок в render.js.
//
// fn(node, t, cam), где t = { x, y, w, h } — уже спроецированный на экран
// прямоугольник узла, cam — { x, y, zoom, w, h }.
// ---------------------------------------------------------------------------
const node_renderers = new Map();
const ui_node_renderers = new Map();

export function registerNodeRenderer(tag, fn) {
    if (typeof tag !== 'string' || typeof fn !== 'function') return;
    node_renderers.set(tag, fn);
}

export function unregisterNodeRenderer(tag) { node_renderers.delete(tag); }

export function registerUINodeRenderer(tag, fn) {
    if (typeof tag !== 'string' || typeof fn !== 'function') return;
    ui_node_renderers.set(tag, fn);
}

export function unregisterUINodeRenderer(tag) { ui_node_renderers.delete(tag); }

const state = {
    clear: '#141824',
    culling: true,
    text_scale: 1,
    stats: { sprites: 0, triangles: 0, texts: 0, nodes: 0 },
};

// Параметры пост-обработки. Держим их на JS-стороне, а в движок отправляем
// каждый кадр: зерну нужно текущее время. Раскладка совпадает с setPost().
const POST_KEYS = ['glow', 'vignette', 'chromatic', 'lens', 'center_x', 'center_y', 'radius',
                   'grain', 'scanline', 'posterize', 'tint_r', 'tint_g', 'tint_b',
                   'tint_amount', 'saturation', 'contrast', 'brightness', 'blood'];

const post_params = {
    glow: 0, vignette: 0, chromatic: 0, lens: 0,
    center_x: 0.5, center_y: 0.5, radius: 0.35,
    grain: 0, scanline: 0, enabled: 0,
    posterize: 0,
    tint_r: 1, tint_g: 1, tint_b: 1, tint_amount: 0,
    saturation: 1, contrast: 1, brightness: 0, blood: 0,
};

// Наборы камерных эффектов: от «тёплого мультика» до хоррора. Значения —
// это те же параметры, что принимает $.gfx.post().
const POST_PRESETS = {
    neutral: {},
    // Сочная, тёплая картинка с мягким свечением — «как в хорошем аниме».
    adventure: {
        glow: 0.5, vignette: 0.2, chromatic: 0.0015, grain: 0.008,
        saturation: 1.22, contrast: 1.06, brightness: 0.02,
        tint_r: 1.06, tint_g: 1.0, tint_b: 0.94, tint_amount: 0.35,
    },
    // Ночной лес: холодная тень, заметная вигнетка, чуть больше зерна.
    forest_night: {
        glow: 0.34, vignette: 0.46, grain: 0.03,
        saturation: 0.95, contrast: 1.08, brightness: -0.02,
        tint_r: 0.88, tint_g: 1.02, tint_b: 1.05, tint_amount: 0.4,
    },
    // Хоррор: почти чёрно-белый, контрастный, с зерном и скан-линиями.
    horror: {
        glow: 0.22, vignette: 0.78, chromatic: 0.004, grain: 0.1, scanline: 0.05,
        saturation: 0.22, contrast: 1.3, brightness: -0.06,
        tint_r: 1.3, tint_g: 0.5, tint_b: 0.5, tint_amount: 0.35, blood: 0.18,
    },
    // Кровавая луна: тот же хоррор, но залитый красным.
    bloodmoon: {
        glow: 0.35, vignette: 0.7, chromatic: 0.006, grain: 0.07,
        saturation: 0.5, contrast: 1.2,
        tint_r: 1.65, tint_g: 0.42, tint_b: 0.42, tint_amount: 0.55, blood: 0.35,
    },
    // Ретро-консоль: постеризация и скан-линии.
    retro: {
        glow: 0.45, vignette: 0.3, scanline: 0.22, posterize: 6,
        saturation: 0.92, contrast: 1.05,
    },
    // Ч/б нуар.
    noir: { glow: 0.3, vignette: 0.62, grain: 0.07, saturation: 0, contrast: 1.35 },
    // Мягкий сон: сильное свечение и минимум контраста.
    dream: {
        glow: 0.85, vignette: 0.12, chromatic: 0.003, grain: 0.02,
        saturation: 1.15, contrast: 0.94, brightness: 0.06,
        tint_r: 1.02, tint_g: 1.0, tint_b: 1.08, tint_amount: 0.3,
    },
};

// Плавный переход между пресетами: снимок «от» и «до» плюс прогресс.
let post_blend = null;

function lerp(a, b, k) { return a + (b - a) * k; }

function applyPreset(name, ms) {
    const preset = POST_PRESETS[name];
    if (!preset) {
        ctx.log(`$: $.gfx.postPreset("${name}") — неизвестный пресет; есть: ${Object.keys(POST_PRESETS).join(', ')}`);
        return false;
    }
    const target = Object.assign({}, preset);
    if (target.tint) { target.tint_r = target.tint[0]; target.tint_g = target.tint[1]; target.tint_b = target.tint[2]; }
    if (Array.isArray(target.tint) || target.tint) delete target.tint;

    const from = {};
    for (const key of POST_KEYS) from[key] = post_params[key];

    if (!(ms > 0)) {
        for (const key of POST_KEYS) if (target[key] !== undefined) post_params[key] = target[key];
        post_params.enabled = 1;
        post_blend = null;
        return true;
    }

    post_blend = { from, to: target, t: 0, ms };
    post_params.enabled = 1;
    return true;
}

/** Двигает плавный переход между пресетами (вызывается из кадра). */
function tickPostBlend(dt_ms) {
    if (!post_blend) return;
    post_blend.t += dt_ms;
    const k = Math.min(1, post_blend.t / post_blend.ms);
    const e = 1 - (1 - k) * (1 - k);            // ease-out
    for (const key of POST_KEYS) {
        const to = post_blend.to[key];
        if (to === undefined) continue;
        post_params[key] = lerp(post_blend.from[key], to, e);
    }
    if (k >= 1) post_blend = null;
}

/** Отправляет параметры поста в движок (с текущим временем для зерна). */
function pushPost() {
    if (typeof engine.setPost !== 'function') return;
    if (typeof engine.postSupported === 'function' && !engine.postSupported()) return;
    tickPostBlend((engine.dt || 0) * 1000);
    engine.setPost(post_params.glow, post_params.vignette, post_params.chromatic, post_params.lens,
                   post_params.center_x, post_params.center_y, post_params.radius,
                   post_params.grain, post_params.scanline, post_params.enabled,
                   engine.time || 0,
                   post_params.posterize,
                   post_params.tint_r, post_params.tint_g, post_params.tint_b, post_params.tint_amount,
                   post_params.saturation, post_params.contrast, post_params.brightness, post_params.blood);
}

function ensureBuffers() {
    if (!xf) {
        xf = new Float32Array(MAX_SPRITES * 6);
        col = new Uint32Array(MAX_SPRITES);
        blend = new Uint8Array(MAX_SPRITES);
        tri = new Float32Array(MAX_TRIS * 3 * 6);
        tri_blend = new Uint8Array(MAX_TRIS);
    }
}

function pushSprite(sprite, x, y, w, h, angle, color, blend_name) {
    if (count >= MAX_SPRITES || sprite < 0) return;
    if (view) { x = viewX(x); y = viewY(y); w = viewScale(w); h = viewScale(h); }
    const o = count * 6;
    xf[o] = sprite; xf[o + 1] = x; xf[o + 2] = y;
    xf[o + 3] = w; xf[o + 4] = h; xf[o + 5] = angle;
    col[count] = color;
    blend[count] = blendId(blend_name === undefined || blend_name === null ? default_blend : blend_name);
    count++;
}

/**
 * Отдаёт в C диапазон спрайтов, разбивая его на непрерывные участки с
 * одинаковым режимом смешивания. Порядок отрисовки сохраняется: конвейер
 * переключается только там, где режим действительно меняется.
 */
function submitSprites(start, end) {
    let i = start;
    while (i < end) {
        const b = blend[i];
        let j = i + 1;
        while (j < end && blend[j] === b) j++;
        engine.submitSprites(xf.subarray(i * 6, j * 6), col.subarray(i, j), j - i, BLEND_NAMES[b]);
        i = j;
    }
}

function pushVertex(x, y, color) {
    if (tri_count >= MAX_TRIS * 3) return;
    if (view) { x = viewX(x); y = viewY(y); }
    const o = tri_count * 6;
    tri[o] = x; tri[o + 1] = y;
    tri[o + 2] = color & 0xff;
    tri[o + 3] = (color >> 8) & 0xff;
    tri[o + 4] = (color >> 16) & 0xff;
    tri[o + 5] = (color >>> 24) & 0xff;
    tri_count++;
}

function pushTriangle(x1, y1, x2, y2, x3, y3, color) {
    const index = tri_count / 3;
    pushVertex(x1, y1, color);
    pushVertex(x2, y2, color);
    pushVertex(x3, y3, color);
    if (index < MAX_TRIS) tri_blend[index] = tri_blend_cur;
}

/** Треугольник, у которого своя альфа на каждой вершине (градиенты, свет). */
function pushTriangleGrad(x1, y1, c1, x2, y2, c2, x3, y3, c3) {
    const index = tri_count / 3;
    pushVertex(x1, y1, c1);
    pushVertex(x2, y2, c2);
    pushVertex(x3, y3, c3);
    if (index < MAX_TRIS) tri_blend[index] = tri_blend_cur;
}

/**
 * Мягкое радиальное свечение: концентрические кольца, у которых альфа падает
 * от центра к краю, а цвет задан на каждой вершине. Из этого собираются
 * факелы, фонари, вспышки и ауры — одна фигура на все случаи.
 *
 * opts: `segments` (по умолчанию 24), `rings` (6), `falloff` (2 — степень
 * затухания), `inner` (доля радиуса, где яркость ещё полная) и `alphaAt(k)`
 * — своя кривая затухания, если нужно.
 */
function pushGlow(cx, cy, radius, color, opts) {
    const o = opts || {};
    const segs = Math.max(6, Math.min(64, o.segments || 24));
    const rings = Math.max(1, Math.min(16, o.rings || 6));
    const falloff = o.falloff === undefined ? 2 : o.falloff;
    const inner = Math.max(0, Math.min(0.9, o.inner || 0));
    const alphaOf = typeof o.alphaAt === 'function'
        ? o.alphaAt
        : (k) => {
            if (k <= inner) return 1;
            const t = (k - inner) / Math.max(1e-6, 1 - inner);
            return Math.pow(1 - t, falloff);
        };

    for (let ring = 0; ring < rings; ring++) {
        const k0 = ring / rings;
        const k1 = (ring + 1) / rings;
        const ca = withAlpha(color, alphaOf(k0));
        const cb = withAlpha(color, alphaOf(k1));
        for (let i = 0; i < segs; i++) {
            const t0 = (i / segs) * Math.PI * 2;
            const t1 = ((i + 1) / segs) * Math.PI * 2;
            const c0 = Math.cos(t0), s0 = Math.sin(t0);
            const c1 = Math.cos(t1), s1 = Math.sin(t1);
            const r0 = radius * k0, r1 = radius * k1;
            pushTriangleGrad(cx + c0 * r0, cy + s0 * r0, ca,
                             cx + c1 * r0, cy + s1 * r0, ca,
                             cx + c1 * r1, cy + s1 * r1, cb);
            pushTriangleGrad(cx + c0 * r0, cy + s0 * r0, ca,
                             cx + c1 * r1, cy + s1 * r1, cb,
                             cx + c0 * r1, cy + s0 * r1, cb);
        }
    }
}

/**
 * Отдаёт треугольники в C участками с одинаковым режимом смешивания —
 * так же, как submitSprites для спрайтов.
 */
function submitTriangles() {
    const total = Math.floor(tri_count / 3);
    let i = 0;
    while (i < total) {
        const b = tri_blend[i];
        let j = i + 1;
        while (j < total && tri_blend[j] === b) j++;
        engine.submitTriangles(tri.subarray(i * 18, j * 18), (j - i) * 3, BLEND_NAMES[b]);
        i = j;
    }
}

/** Радиальный «блин» — мягкое свечение и круг. */
function pushDisc(cx, cy, radius, color, segments) {
    radius = viewScale(radius);
    const n = segments || Math.max(8, Math.min(48, Math.round(radius / 4)));
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        pushTriangle(cx, cy,
                     cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius,
                     cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius,
                     color);
    }
}

/** Кольцо для .outline() и отладочных окружностей. */
function pushRing(cx, cy, radius, width, color, segments) {
    radius = viewScale(radius);
    width = viewScale(width);
    const n = segments || Math.max(10, Math.min(64, Math.round(radius / 3)));
    const inner = Math.max(0, radius - width);
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        pushTriangle(cx + c0 * inner, cy + s0 * inner,
                     cx + c1 * inner, cy + s1 * inner,
                     cx + c1 * radius, cy + s1 * radius, color);
        pushTriangle(cx + c0 * inner, cy + s0 * inner,
                     cx + c1 * radius, cy + s1 * radius,
                     cx + c0 * radius, cy + s0 * radius, color);
    }
}

// ---------------------------------------------------------------------------
// Отрисовка узла
// ---------------------------------------------------------------------------

function nodeTransform(node, cam) {
    let sx = (node.x - cam.x) * cam.zoom + cam.w / 2 + cam.shake_x;
    let sy = (node.y - cam.y) * cam.zoom + cam.h / 2 + cam.shake_y;
    if (node.shake_timer > 0) {
        const p = node.shake_total > 0 ? node.shake_timer / node.shake_total : 1;
        const amp = node.shake_amount * p;
        sx += (fxRandom() * 2 - 1) * amp;
        sy += (fxRandom() * 2 - 1) * amp;
    }
    return {
        x: sx,
        y: sy,
        w: node.w * node.scale_x * cam.zoom,
        h: node.h * node.scale_y * cam.zoom,
    };
}

function baseColor(node) {
    let color = node.tint && node.tint_timer > 0 ? node.tint : node.color;
    if (node.alpha < 1) color = withAlpha(color, node.alpha);
    return color;
}

function drawWorldNode(node, cam) {
    if (!node.visible || node.alpha <= 0) return;

    const t = nodeTransform(node, cam);

    // Свои теги рисует модуль. Проверяем до отсечения: у <tilemap> и
    // <particles> собственный габарит, который общий прямоугольник узла не
    // описывает, и модуль отсекает себя сам, если умеет.
    const custom = node_renderers.get(node.tag);
    if (custom) {
        state.stats.nodes++;
        custom(node, t, cam);
        return;
    }

    if (state.culling) {
        if (t.x + Math.abs(t.w) < -64 || t.x - Math.abs(t.w) > cam.w + 64 ||
            t.y + Math.abs(t.h) < -64 || t.y - Math.abs(t.h) > cam.h + 64) return;
    }
    state.stats.nodes++;

    switch (node.tag) {
    case 'circle': {
        pushDisc(t.x, t.y, Math.abs(t.w) / 2, baseColor(node));
        break;
    }
    case 'light': {
        // Свет — мягкое радиальное свечение (pushGlow): цвет и альфа на
        // каждой вершине, поэтому градиент гладкий на любом радиусе, а
        // стоимость — одна фигура. Режим смешивания берём у узла: для света
        // обычно .blend('add').
        const r = Math.max(2, node.radius * cam.zoom);
        const power = node.alpha * Math.max(0, Math.min(2, node.intensity));
        if (power <= 0.001) break;
        const attrs = node.attrs || {};
        const prev_blend = tri_blend_cur;
        tri_blend_cur = blendId(node.blend_mode);
        pushGlow(t.x, t.y, r, packColor(node.color), {
            segments: attrs.segments === undefined ? 26 : Math.round(attrs.segments),
            rings: attrs.rings === undefined ? 7 : Math.round(attrs.rings),
            falloff: attrs.falloff === undefined ? 2 : attrs.falloff,
            inner: attrs.inner === undefined ? 0 : attrs.inner,
            alphaAt: (k) => power * Math.pow(1 - k, attrs.falloff === undefined ? 2 : attrs.falloff),
        });
        tri_blend_cur = prev_blend;
        break;
    }
    case 'text': {
        ctx.gfx._queueText(node.text, t.x, t.y, node.size * cam.zoom, baseColor(node), node.attrs.align || 'left');
        break;
    }
    default: {
        const sprite = node.sprite >= 0 ? node.sprite : engine.whiteSprite;

        // Тень: смещённая тёмная копия ПОД спрайтом.
        if (node.shadow) {
            const sh = node.shadow;
            const alpha = node.alpha * (sh.color_packed >>> 24) / 255;
            pushSprite(sprite, t.x + sh.x * cam.zoom, t.y + sh.y * cam.zoom,
                       t.w, t.h, node.angle,
                       withAlpha(sh.color_packed, alpha));
        }

        // Контур: прямоугольник чуть больше спрайта, тоже под ним. Форма
        // повторяет хитбокс, а не силуэт картинки — так же, как у брашей.
        if (node.outline) {
            const w = node.outline.width * cam.zoom;
            pushSprite(engine.whiteSprite, t.x, t.y, t.w + w * 2, t.h + w * 2,
                       node.angle, withAlpha(node.outline.color, node.alpha));
        }

        pushSprite(sprite, t.x, t.y, t.w, t.h, node.angle, baseColor(node), node.blend_mode);
        break;
    }
    }
}

function drawUINode(node) {
    if (!node.visible || node.alpha <= 0) return;
    const p = packColor(node.color, node.alpha);

    const custom = ui_node_renderers.get(node.tag);
    if (custom) { custom(node, p); return; }

    switch (node.tag) {
    case 'ui.panel':
        pushSprite(engine.whiteSprite, node.x, node.y, node.w, node.h, 0, p);
        break;
    case 'ui.bar': {
        pushSprite(engine.whiteSprite, node.x, node.y, node.w, node.h, 0, p);
        const max = node.max_value || 1;
        const ratio = Math.max(0, Math.min(1, node.value / max));
        const fill = withAlpha(packColor(node.fill_color), node.alpha);
        if (ratio > 0) {
            pushSprite(engine.whiteSprite,
                       node.x - node.w / 2 + (node.w * ratio) / 2,
                       node.y, node.w * ratio, node.h, 0, fill);
        }
        if (node.text) {
            ctx.gfx._queueText(node.text, node.x, node.y, node.size, node.text_color, 'center');
        }
        break;
    }
    case 'ui.button': {
        const color = node.hovered ? packColor(node.hover_color || '#2e405f', node.alpha) : p;
        pushSprite(engine.whiteSprite, node.x, node.y, node.w, node.h, 0, color);
        ctx.gfx._queueText(node.text, node.x, node.y, node.size, node.text_color, 'center');
        break;
    }
    case 'ui.label':
        ctx.gfx._queueText(node.text, node.x, node.y, node.size, withAlpha(packColor(node.color), node.alpha),
                           node.attrs.align || 'left');
        break;
    case 'ui.image':
        pushSprite(node.sprite >= 0 ? node.sprite : engine.whiteSprite,
                   node.x, node.y, node.w, node.h, node.angle, p);
        break;
    default:
        pushSprite(node.sprite >= 0 ? node.sprite : engine.whiteSprite,
                   node.x, node.y, node.w, node.h, node.angle, p);
        break;
    }
}

// ---------------------------------------------------------------------------
// Сортировка
// ---------------------------------------------------------------------------

function sortedNodes() {
    const world = ctx.world;
    const mode = world ? world._state.sort_mode : 'layer';
    const fn = world ? world._state.sort_fn : null;
    const list = ctx.nodes.filter((n) => !n.attrs.ui);
    if (fn) { list.sort(fn); return list; }
    list.sort((a, b) => {
        if (a.layer !== b.layer) return a.layer - b.layer;
        if (mode === 'y') return a.y - b.y;
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.uid - b.uid;
    });
    return list;
}

// ---------------------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------------------

export function installGfx($) {
    ensureBuffers();

    const gfx = {
        /** Цвет очистки кадра. */
        color(value) {
            if (value === undefined) return state.clear;
            state.clear = value;
            const packed = packColor(value);
            engine.setClearColor((packed & 0xff) / 255, ((packed >> 8) & 0xff) / 255,
                                 ((packed >> 16) & 0xff) / 255, ((packed >>> 24) & 0xff) / 255);
            return gfx;
        },

        /** Отсечение по экрану: false — рисуем всё (полезно для отладки). */
        culling(on) { state.culling = on !== false; return gfx; },

        /** Размер окна в логических точках. */
        size() { return { w: engine.width, h: engine.height }; },

        /** Цвет-утилита, чтобы не тянуть engine.rgba в игре. */
        rgba(r, g, b, a) { return engine.rgba(r, g, b, a === undefined ? 255 : a); },
        color4(hex, alpha) { return withAlpha(packColor(hex), alpha === undefined ? 1 : alpha); },

        /** Сколько спрайтов/треугольников ушло в кадр — для $.debug.stats(). */
        stats() { return { ...state.stats }; },

        // --- Примитивы поверх всего (в координатах окна) --------------------
        draw: {
            /**
             * Мягкое свечение в мировых координатах: `radius` в пикселях мира,
             * `opts` — `segments`, `rings`, `falloff`, `inner`, `blend`
             * (`'add'` даёт настоящее свечение).
             *
             * ```js
             * $.gfx.draw.glow(x, y, 160, '#ffbe73', { blend: 'add', falloff: 2.2 });
             * ```
             */
            glow(x, y, radius, color, opts) {
                const o = opts || {};
                const prev = tri_blend_cur;
                const prev_view = view;
                setView(cameraTransform());
                tri_blend_cur = blendId(o.blend === undefined ? 'add' : o.blend);
                pushGlow(x, y, radius, packColor(color === undefined ? '#ffffff' : color), o);
                tri_blend_cur = prev;
                view = prev_view;
                return gfx;
            },

            line(x1, y1, x2, y2, color, width) {
                draw_calls.push({ kind: 'line', x1, y1, x2, y2, color: packColor(color), width: width || 1 });
            },
            rect(x, y, w, h, color) {
                draw_calls.push({ kind: 'rect', x, y, w, h, color: packColor(color) });
            },
            circle(x, y, r, color) {
                draw_calls.push({ kind: 'circle', x, y, r, color: packColor(color) });
            },
            ring(x, y, r, color, width) {
                draw_calls.push({ kind: 'ring', x, y, r, color: packColor(color), width: width || 2 });
            },
            /** Текст на отладочном слое. opts: { size, align }. */
            text(text, x, y, color, size, align) {
                draw_calls.push({ kind: 'text', text, x, y, color: packColor(color),
                                  size: size || 16, align: align || 'left' });
            },
            arrow(x1, y1, x2, y2, color) {
                draw_calls.push({ kind: 'arrow', x1, y1, x2, y2, color: packColor(color) });
            },
            clear() { draw_calls.length = 0; return gfx; },
        },

        /** Очередь текста: C рисует её поверх сцены шрифтом ImGui. */
        text(text, x, y, opts) {
            const o = opts || {};
            gfx._queueText(String(text), x, y, (o.size || 20) * state.text_scale,
                           packColor(o.color, o.alpha), o.align || 'left');
            return gfx;
        },

        /** Ширина и высота строки в пикселях — для центрирования вручную. */
        measureText(text, size) { return engine.measureText(String(text), size || 20); },

        /** Размер картинки в пикселях: [ширина, высота]. */
        textureSize(path) { return engine.textureSize(engine.loadTexture(path)); },

        // --- Батч для модулей подсистем --------------------------------------
        // Всё, что рисуют модули (тайлы, частицы, слои), идёт через эти
        // функции: они пишут в тот же буфер кадра, что и ядро, поэтому
        // лишних draw call'ов не появляется. Вызывать только из
        // отрисовщика, зарегистрированного через registerNodeRenderer.
        push: {
            /** Спрайт: x/y — центр, angle в радианах, color — упакованный RGBA,
             *  blend — 'alpha' (по умолчанию) | 'add' | 'multiply' | 'none'. */
            sprite(sprite, x, y, w, h, angle, color, blend) {
                pushSprite(sprite, x, y, w, h, angle || 0,
                           color === undefined ? 0xffffffff : color, blend);
            },
            /** Треугольник с цветом на вершину; blend — режим смешивания. */
            triangle(x1, y1, x2, y2, x3, y3, color, blend) {
                tri_blend_cur = blend === undefined || blend === null ? 0 : blendId(blend);
                pushTriangle(x1, y1, x2, y2, x3, y3, color);
                tri_blend_cur = 0;
            },
            /** Отрезок заданной толщины (двумя треугольниками). */
            line(x1, y1, x2, y2, width, color) {
                pushLine(x1, y1, x2, y2, width || 1, color);
            },
            /** Круг/диск: cx/cy — центр, r — радиус. */
            circle(cx, cy, r, color, segments) { pushDisc(cx, cy, r, color, segments); },
            /** Кольцо: cx/cy — центр, r — радиус, width — толщина обода. */
            ring(cx, cy, r, width, color, segments) { pushRing(cx, cy, r, width || 2, color, segments); },
            /** Сколько спрайтов и треугольников уже набрано в этом кадре. */
            stats() { return { sprites: count, triangles: tri_count }; },
        },

        /** Режим смешивания по умолчанию: 'alpha' | 'add' | 'multiply' | 'none'. */
        blend(name) {
            if (name === undefined) return default_blend;
            if (!BLEND_IDS.has(name)) {
                ctx.log(`$: $.blend("${name}") — неизвестный режим; доступны: ${BLEND_NAMES.join(', ')}`);
                return default_blend;
            }
            default_blend = name;
            return default_blend;
        },

        /**
         * Пост-обработка кадра: свечение, вигнетка, хроматика, зерно,
         * скан-линии и линза. Без аргумента — текущие параметры.
         *
         * Линза — экранное искажение: `{ lens, centerX, centerY, radius }`.
         * Ею делаются «чёрная дыра», взрывная волна и любой warp; `glow` даёт
         * свечение вспышек, `chromatic` — радужную кромку.
         *
         * ```js
         * $.gfx.post({ glow: 0.6, vignette: 0.3 });
         * $.gfx.post({ lens: 1.2, centerX: 0.5, centerY: 0.5, radius: 0.3 });
         * $.gfx.post({ on: false });
         * ```
         */
        post(opts) {
            if (typeof engine.postSupported !== 'function' || !engine.postSupported()) {
                return opts === undefined ? null : gfx;
            }
            if (opts === undefined) return Object.assign({}, post_params, engine.getPost());
            const o = Object.assign({}, opts);
            if (o.centerX !== undefined) { post_params.center_x = o.centerX; }
            if (o.centerY !== undefined) { post_params.center_y = o.centerY; }
            if (o.radius !== undefined) { post_params.radius = o.radius; }
            if (o.on !== undefined) post_params.enabled = o.on === false ? 0 : 1;
            if (o.enabled !== undefined) post_params.enabled = o.enabled ? 1 : 0;
            if (Array.isArray(o.tint)) {
                post_params.tint_r = Number(o.tint[0]);
                post_params.tint_g = Number(o.tint[1]);
                post_params.tint_b = Number(o.tint[2]);
                if (o.on === undefined && o.enabled === undefined) post_params.enabled = 1;
            }
            const keys = ['glow', 'vignette', 'chromatic', 'lens', 'grain', 'scanline',
                          'posterize', 'tint_r', 'tint_g', 'tint_b', 'tint_amount',
                          'saturation', 'contrast', 'brightness', 'blood'];
            for (const key of keys) {
                if (o[key] !== undefined) {
                    post_params[key] = Number(o[key]) || 0;
                    // Задать эффект и не включить пост — почти всегда ошибка:
                    // включаем сами, если игру это не оговорила.
                    if (o.on === undefined && o.enabled === undefined) post_params.enabled = 1;
                }
            }
            pushPost();
            return gfx;
        },

        /**
         * Готовый набор камерных эффектов: `'adventure'` (тёплый мультик),
         * `'forest_night'`, `'horror'`, `'bloodmoon'`, `'retro'`, `'noir'`,
         * `'dream'`, `'neutral'`. Второй аргумент — миллисекунды плавного
         * перехода (`{ ms: 800 }`), без него эффект включается сразу.
         */
        postPreset(name, opts) {
            if (name === undefined) return Object.keys(POST_PRESETS);
            const ms = opts && opts.ms !== undefined ? Number(opts.ms) : 0;
            applyPreset(String(name), ms);
            return gfx;
        },

        /** Текущий пресет не отслеживаем, но список — вот он. */
        postPresets() { return Object.keys(POST_PRESETS); },

        /** Выключить пост-обработку (кадр идёт прямо на экран). */
        postOff() {
            post_params.enabled = 0;
            pushPost();
            return gfx;
        },

        /** Поддерживает ли сборка пост-обработку (нужен GPU-проход). */
        postSupported() {
            return typeof engine.postSupported === 'function' && !!engine.postSupported();
        },

        /** Регистрация своего отрисовщика тега — см. registerNodeRenderer. */
        registerNodeRenderer,
        registerUINodeRenderer,

        /** Дублирует отрисовку узлов вручную (нужно редко). */
        _queueText(text, x, y, size, color, align) {
            state.stats.texts++;
            engine.drawText(text, x, y, size, color, align || 'left');
        },

        // --- Кадр ------------------------------------------------------------
        _render() {
            const cam = cameraTransform();
            // Зерну нужно текущее время, поэтому параметры поста уходят в
            // движок каждый кадр, даже если игра их не меняла.
            pushPost();
            state.stats = { sprites: 0, triangles: 0, texts: 0, nodes: 0 };
            count = 0;
            tri_count = 0;
            tri_blend_cur = 0;

            // Фон рисуется первым и не двигается с камерой при parallax=0.
            const bg = ctx.world ? ctx.world.getBackground() : null;
            if (bg && bg.sprite >= 0) {
                const px = bg.parallax;
                const bx = engine.width / 2 - (cam.x * px * cam.zoom);
                const by = engine.height / 2 - (cam.y * px * cam.zoom) + bg.y;
                pushSprite(bg.sprite, bx, by, engine.width * bg.scale, engine.height * bg.scale, 0, bg.color);
            }

            const list = sortedNodes();
            // Y-sort карты: tilemap с включённым ysort дорисовывает свои полосы
            // по мере прохода по узлам, чтобы сущности вставали между тайлами.
            // Хуки ставит модуль tilemap; если его нет — цикл как раньше.
            for (const node of list) {
                if (ctx.gfx._ysortFlush) ctx.gfx._ysortFlush(cam, node.y);
                drawWorldNode(node, cam);
            }
            if (ctx.gfx._ysortFlushEnd) ctx.gfx._ysortFlushEnd(cam);

            // Полосы, кольца и отладочные примитивы — треугольниками поверх сцены.
            for (const call of draw_calls) {
                switch (call.kind) {
                case 'rect': pushSprite(engine.whiteSprite, call.x + call.w / 2, call.y + call.h / 2, call.w, call.h, 0, call.color); break;
                case 'circle': pushDisc(call.x, call.y, call.r, call.color); break;
                case 'ring': pushRing(call.x, call.y, call.r, call.width, call.color); break;
                case 'line': pushLine(call.x1, call.y1, call.x2, call.y2, call.width, call.color); break;
                case 'arrow': {
                    pushLine(call.x1, call.y1, call.x2, call.y2, 2, call.color);
                    const ang = Math.atan2(call.y2 - call.y1, call.x2 - call.x1);
                    const head = 10;
                    pushLine(call.x2, call.y2, call.x2 - Math.cos(ang - 0.4) * head, call.y2 - Math.sin(ang - 0.4) * head, 2, call.color);
                    pushLine(call.x2, call.y2, call.x2 - Math.cos(ang + 0.4) * head, call.y2 - Math.sin(ang + 0.4) * head, 2, call.color);
                    break;
                }
                case 'text':
                    ctx.gfx._queueText(call.text, call.x, call.y, call.size, call.color, call.align);
                    break;
                default: break;
                }
            }
            draw_calls.length = 0;

            // VFX-слой (ленты, молнии, ударные волны). Хук ставит модуль fx.js:
            // рисовать нужно именно здесь — батч живёт только внутри кадра.
            if (ctx.gfx._fxFlush) {
                setView(cam);            // VFX приходят в мировых координатах
                ctx.gfx._fxFlush(cam);
                setView(null);
            }

            // Сцена: спрайты одним вызовом, затем треугольники (они поверх).
            if (count > 0) submitSprites(0, count);

            // Интерфейс — в координатах окна, камера не влияет.
            const ui_start = count;
            for (const node of ctx.nodes) if (node.attrs.ui) drawUINode(node);
            if (count > ui_start) {
                // UI идёт после треугольников, поэтому отдаём его отдельным
                // пакетом: сначала сцена, потом интерфейс поверх.
                // Метка нужна движку: с пост-обработкой HUD рисуется уже после
                // неё, иначе вигнетка и линза затемняли бы интерфейс.
                if (typeof engine.markUI === 'function') engine.markUI();
                submitSprites(ui_start, count);
            }

            if (tri_count > 0) submitTriangles();

            // Затемнение перехода между сценами — отдельным односпрайтовым
            // пакетом, чтобы не занимать слот в общем буфере.
            const alpha = ctx.scene ? ctx.scene._transitionAlpha() : 0;
            if (alpha > 0) {
                overlay_xf[0] = engine.whiteSprite;
                overlay_xf[1] = engine.width / 2;
                overlay_xf[2] = engine.height / 2;
                overlay_xf[3] = engine.width;
                overlay_xf[4] = engine.height;
                overlay_xf[5] = 0;
                overlay_col[0] = engine.rgba(0, 0, 0, Math.round(alpha * 255));
                engine.submitSprites(overlay_xf, overlay_col, 1);
            }

            state.stats.sprites = count;
            state.stats.triangles = tri_count;
        },
    };

    // $.gfx.draw.* — мировой слой: оборачиваем методы, чтобы координаты
    // переводились через текущую камеру. Иначе круг или стрелка, нарисованные
    // в мировых координатах, уезжали на расстояние камеры.
    for (const key of Object.keys(gfx.draw)) {
        const fn = gfx.draw[key];
        if (typeof fn !== 'function') continue;
        gfx.draw[key] = function (...args) {
            const prev = view;
            setView(cameraTransform());
            try {
                return fn.apply(gfx.draw, args);
            } finally {
                view = prev;
            }
        };
    }

    ctx.gfx = gfx;
    return gfx;
}

function pushLine(x1, y1, x2, y2, width, color) {
    width = viewScale(width);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    pushTriangle(x1 + nx, y1 + ny, x1 - nx, y1 - ny, x2 - nx, y2 - ny, color);
    pushTriangle(x1 + nx, y1 + ny, x2 - nx, y2 - ny, x2 + nx, y2 + ny, color);
}
