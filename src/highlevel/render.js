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

import { ctx, wrap, def, TAGS, packColor, withAlpha, fxRandom,
         facetCount, nodesWithFacet, registryVersion, spriteSize,
         regionSprite } from './core.js';
import { cameraTransform } from './camera.js';

const MAX_SPRITES = 16384;
const MAX_TRIS = 8192;

let xf = null;          // Float32Array(max * 6)
let col = null;         // Uint32Array(max)
let blend = null;       // Uint8Array(max) — режим смешивания каждого спрайта
let fx = null;          // Int32Array(max) — индекс шейдера узла (0 — обычный)
let count = 0;

// Порядок обязан совпадать с порядком конвейеров в render.c.
const BLEND_NAMES = ['alpha', 'add', 'multiply', 'none'];
const BLEND_IDS = new Map(BLEND_NAMES.map((n, i) => [n, i]));

// Кэш на одно имя: режим у всех спрайтов кадра почти всегда один и тот же
// (умолчание или .blend() конкретного узла), а Map.get по строке на КАЖДЫЙ
// спрайт — это ≈0,5 мкс × 1000 (§3.4, пункт 11 плана).
let blend_memo_name = null;
let blend_memo_id = 0;
function blendId(name) {
    if (name === blend_memo_name) return blend_memo_id;
    const id = BLEND_IDS.get(name);
    blend_memo_name = name;
    blend_memo_id = id === undefined ? 0 : id;
    return blend_memo_id;
}

// Режим по умолчанию для всех спрайтов кадра: его задаёт $.blend(...)
// (модуль viewport.js). Узел может переопределить его через .blend().
let default_blend = 'alpha';
let tri = null;         // Float32Array(max * 3 * 6)
let tri_count = 0;      // число вершин (кратно 3)
let tri_blend = null;   // Uint8Array(max) — режим смешивания каждого треугольника
let tri_blend_cur = 0;  // режим, который получит следующий треугольник
let tri_layer = null;   // Uint8Array(max) — 1, если треугольник это свет lightmap
let tri_layer_cur = 0;  // слой, который получит следующий треугольник (0 — сцена)

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

// --- Шейдеры узлов -----------------------------------------------------------
// Узлов с эффектом обычно единицы, а параметры у них разные, поэтому на кадр
// собирается таблица: ключ (вид + параметры) → индекс в таблице движка.
// Ноль зарезервирован под «обычный спрайт», поэтому индексы идут с единицы.
const MAX_NODE_FX = 60;
let fx_map = new Map();
let fx_count = 0;

// Пользовательские шейдеры: имя → слот в движке. Компилируются один раз при
// регистрации (glslang + spirv-cross), дальше это обычный конвейер.
const user_shaders = new Map();
let user_shader_error = '';

/** Виды эффектов шейдера узла: имя → номер в шейдере sprite_fx.frag.glsl. */
const FX_KINDS = {
    none: 0,
    flash: 1,
    dissolve: 2,
    chroma: 3,
    wave: 4,
};

/**
 * Приводит имя эффекта и его параметры к тому, что ждёт движок:
 * `{ kind, p1, p2, p3, color }`. Чистая функция — её проверяет qjs-харнесс.
 *
 * flash    — `{ color, amount }`: подсветка цветом (попадание, урон)
 * dissolve — `{ threshold, scale, color }`: растворение с кромкой
 * chroma   — `{ offset }`: расхождение каналов (глитч, удар)
 * wave     — `{ amplitude, frequency, phase }`: волна по UV (жар, вода)
 */
export function fxSpec(name, params, users) {
    const p = params || {};
    const key_name = String(name);
    // Пользовательский шейдер: вид не встроенный, но конвейер свой, поэтому
    // в таблице эффектов он отличается полем user, а не номером вида.
    const user = users && users.get ? users.get(key_name) : undefined;
    if (user !== undefined) {
        return {
            kind: 0,
            user,
            p1: fxNumber(p.p1, 0),
            p2: fxNumber(p.p2, 0),
            p3: fxNumber(p.p3, 0),
            color: p.color,
        };
    }
    const kind = FX_KINDS[key_name] || 0;
    const num = (value, fallback) => {
        // null/пустая строка — это «параметр не задан», а не ноль: иначе
        // `{ frequency: null }` дал бы частоту 0 и волна исчезла бы.
        if (value === null || value === undefined || value === '') return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    if (kind === FX_KINDS.flash) {
        // p1 — сила подсветки, цвет — отдельным vec4.
        return { kind, p1: clamp01(num(p.amount, 0.8)), p2: 0, p3: 0, color: p.color };
    }
    if (kind === FX_KINDS.dissolve) {
        // p1 — порог, p2 — масштаб шума (частота дыр).
        return { kind, p1: clamp01(num(p.threshold, 0.5)),
                 p2: Math.max(1, num(p.scale, 64)), p3: 0,
                 color: p.color === undefined ? '#ff8844' : p.color };
    }
    if (kind === FX_KINDS.chroma) {
        return { kind, p1: num(p.offset, 0.01), p2: 0, p3: 0, color: p.color };
    }
    if (kind === FX_KINDS.wave) {
        // p1 — амплитуда, p2 — частота, p3 — фаза (время).
        return { kind,
                 p1: num(p.amplitude !== undefined ? p.amplitude : p.amount, 0.03),
                 p2: Math.max(1, num(p.frequency, 24)),
                 p3: num(p.phase !== undefined ? p.phase : p.time, 0),
                 color: p.color };
    }
    return { kind: 0, p1: 0, p2: 0, p3: 0, color: undefined };
}

/** Список доступных видов эффектов — для документации и проверок. */
export function fxKinds() { return Object.keys(FX_KINDS); }

/** Число из параметра: нечисло и «не задано» превращаются в значение по умолчанию. */
function fxNumber(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Проверяет тело пользовательского шейдера до отправки в компилятор: так
 * ошибка видна сразу в JS (`$: ...`), а не только в журнале glslang.
 * Возвращает текст проблемы или пустую строку, если всё в порядке.
 */
export function userShaderBodyError(body) {
    if (typeof body !== 'string' || body.trim() === '') return 'пустой исходник шейдера';
    if (body.includes('#version')) {
        return 'не пишите #version: шапку с версией и привязками подставляет движок '
             + '(см. $.gfx.shaderPreamble())';
    }
    if (!/void\s+main\s*\(/.test(body)) return 'нет точки входа void main()';
    if (!/o_color/.test(body)) {
        return 'результат нужно записать в o_color (например, '
             + 'o_color = texture(u_texture, v_texcoord) * v_color;)';
    }
    return '';
}

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : (n > 1 ? 1 : n);
}

/**
 * Индекс шейдера узла в таблице кадра. Узлы с одинаковым эффектом и
 * одинаковыми параметрами делят один индекс — тогда они рисуются одним
 * вызовом, как и раньше (участок не рвётся).
 */
function fxIndexOf(node) {
    const name = node && node.shader_name;
    if (!name || name === 'none') return 0;
    const spec = fxSpec(name, node.shader_params, user_shaders);
    if (spec.kind === 0 && !spec.user) return 0;
    // Для волны фаза меняется каждый кадр — она и делает параметры разными.
    const phase = spec.phase === undefined ? '' : String(spec.phase);
    const key = spec.kind + '|' + (spec.user || 0) + '|' + spec.p1 + '|' + spec.p2
              + '|' + spec.p3 + '|' + phase
              + '|' + (spec.color === undefined ? '' : String(spec.color));
    const cached = fx_map.get(key);
    if (cached !== undefined) return cached;
    if (fx_count >= MAX_NODE_FX) return 0;
    const index = ++fx_count;
    if (typeof engine.defineSpriteFx === 'function') {
        engine.defineSpriteFx(index, spec.kind, spec.p1, spec.p2, spec.p3,
                              packColorSafe(spec.color), spec.user || 0);
    }
    fx_map.set(key, index);
    return index;
}

/** Цвет эффекта в упакованный RGBA; без цвета — белый с полной альфой. */
function packColorSafe(color) {
    if (color === undefined || color === null) return 0xFFFFFFFF;
    return packColor(color, 1);
}

// Параметры пост-обработки. Держим их на JS-стороне, а в движок отправляем
// каждый кадр: зерну нужно текущее время. Раскладка совпадает с setPost().
const POST_KEYS = ['glow', 'vignette', 'chromatic', 'lens', 'center_x', 'center_y', 'radius',
                   'grain', 'scanline', 'posterize', 'tint_r', 'tint_g', 'tint_b',
                   'tint_amount', 'saturation', 'contrast', 'brightness', 'blood',
                   'bloom_threshold', 'bloom_radius'];

const post_params = {
    glow: 0, vignette: 0, chromatic: 0, lens: 0,
    center_x: 0.5, center_y: 0.5, radius: 0.35,
    grain: 0, scanline: 0, enabled: 0,
    posterize: 0,
    tint_r: 1, tint_g: 1, tint_b: 1, tint_amount: 0,
    saturation: 1, contrast: 1, brightness: 0, blood: 0,
    // Свечение: порог яркости и сила размытия. Само свечение — отдельные
    // проходы (bright-pass + размытие), а не выборки в пост-обработке.
    bloom_threshold: 0.75, bloom_radius: 1,
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
                   post_params.saturation, post_params.contrast, post_params.brightness, post_params.blood,
                   post_params.bloom_threshold, post_params.bloom_radius);
}

function ensureBuffers() {
    if (!xf) {
        xf = new Float32Array(MAX_SPRITES * 6);
        col = new Uint32Array(MAX_SPRITES);
        blend = new Uint8Array(MAX_SPRITES);
        fx = new Int32Array(MAX_SPRITES);
        tri = new Float32Array(MAX_TRIS * 3 * 6);
        tri_blend = new Uint8Array(MAX_TRIS);
        tri_layer = new Uint8Array(MAX_TRIS);
    }
}

function pushSprite(sprite, x, y, w, h, angle, color, blend_name, fx_index) {
    if (count >= MAX_SPRITES || sprite < 0) return;
    if (view) { x = viewX(x); y = viewY(y); w = viewScale(w); h = viewScale(h); }
    const o = count * 6;
    xf[o] = sprite; xf[o + 1] = x; xf[o + 2] = y;
    xf[o + 3] = w; xf[o + 4] = h; xf[o + 5] = angle;
    col[count] = color;
    blend[count] = blendId(blend_name === undefined || blend_name === null ? default_blend : blend_name);
    // Индекс шейдера узла: 0 — обычный спрайт (конвейер без юниформ).
    fx[count] = fx_index === undefined ? 0 : fx_index;
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
        const f = fx[i];
        let j = i + 1;
        // Участок рвётся и по режиму смешивания, и по шейдеру узла: у разных
        // шейдеров разные юниформы, а без разрыва они бы «протекли» на соседей.
        while (j < end && blend[j] === b && fx[j] === f) j++;
        engine.submitSprites(xf.subarray(i * 6, j * 6), col.subarray(i, j), j - i,
                             BLEND_NAMES[b], f > 0 ? fx.subarray(i, j) : null);
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
    if (index < MAX_TRIS) {
        tri_blend[index] = tri_blend_cur;
        tri_layer[index] = tri_layer_cur;
    }
}

/** Треугольник, у которого своя альфа на каждой вершине (градиенты, свет). */
function pushTriangleGrad(x1, y1, c1, x2, y2, c2, x3, y3, c3) {
    const index = tri_count / 3;
    pushVertex(x1, y1, c1);
    pushVertex(x2, y2, c2);
    pushVertex(x3, y3, c3);
    if (index < MAX_TRIS) {
        tri_blend[index] = tri_blend_cur;
        tri_layer[index] = tri_layer_cur;
    }
}

/**
 * Кривая затухания свечения: `falloff` (2 — степень), `inner` (доля радиуса,
 * где яркость ещё полная) и своя `alphaAt(k)`, если нужно. Общая для мягкого
 * пятна (pushGlow) и для света с тенями и конусом — чтобы оба светили одинаково.
 */
function glowAlphaCurve(o) {
    const inner = Math.max(0, Math.min(0.9, o.inner || 0));
    const falloff = o.falloff === undefined ? 2 : o.falloff;
    if (typeof o.alphaAt === 'function') return o.alphaAt;
    return (k) => {
        if (k <= inner) return 1;
        const t = (k - inner) / Math.max(1e-6, 1 - inner);
        return Math.pow(1 - t, falloff);
    };
}

/**
 * Мягкое радиальное свечение: концентрические кольца, у которых альфа падает
 * от центра к краю, а цвет задан на каждой вершине. Из этого собираются
 * факелы, фонари, вспышки и ауры — одна фигура на все случаи.
 *
 * opts: `segments` (по умолчанию 24), `rings` (6), `falloff`, `inner`,
 * `alphaAt(k)` — см. glowAlphaCurve().
 */
function pushGlow(cx, cy, radius, color, opts) {
    const o = opts || {};
    const segs = Math.max(6, Math.min(64, o.segments || 24));
    const rings = Math.max(1, Math.min(16, o.rings || 6));
    const alphaOf = glowAlphaCurve(o);

    // Тригонометрия от кольца не зависит: считаем один раз на пятно, а не
    // rings раз. Раньше cos/sin звались внутри цикла по кольцам — 6-7× лишних
    // вызовов на каждую точку окружности, а это самый частый путь света.
    const cos = fanScratch(segs, 0);
    const sin = fanScratch(segs, 1);
    for (let i = 0; i < segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        cos[i] = Math.cos(t);
        sin[i] = Math.sin(t);
    }

    for (let ring = 0; ring < rings; ring++) {
        const k0 = ring / rings;
        const k1 = (ring + 1) / rings;
        const ca = withAlpha(color, alphaOf(k0));
        const cb = withAlpha(color, alphaOf(k1));
        const r0 = radius * k0, r1 = radius * k1;
        for (let i = 0; i < segs; i++) {
            const j = (i + 1) % segs;
            const c0 = cos[i], s0 = sin[i];
            const c1 = cos[j], s1 = sin[j];
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
 * Отдаёт треугольники в C участками с одинаковым режимом смешивания и слоем.
 * Слой 1 — свет lightmap: он уходит своим вызовом и рисуется не в сцену, а в
 * текстуру света.
 */
function submitTriangles() {
    const total = Math.floor(tri_count / 3);
    const light_ok = typeof engine.submitLightTriangles === 'function';
    let i = 0;
    while (i < total) {
        const b = tri_blend[i];
        const layer = tri_layer[i];
        let j = i + 1;
        while (j < total && tri_blend[j] === b && tri_layer[j] === layer) j++;
        const part = tri.subarray(i * 18, j * 18);
        const n = (j - i) * 3;
        if (layer && light_ok) {
            engine.submitLightTriangles(part, n, BLEND_NAMES[b]);
        } else {
            engine.submitTriangles(part, n, BLEND_NAMES[b]);
        }
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

// ===========================================================================
// Свет в стиле Candle: тени внутри <light>, конус, площадной свет и туман.
//
// Узел <light> умеет не только мягкое пятно (pushGlow), но и честную границу:
// из центра выпускаются лучи, каждый упирается в ближайшее препятствие, и по
// этим расстояниям строится концентрический веер. Градиент остаётся мягким, а
// кромка тени — резкой, как в Candle.
//
// Препятствия берутся из общего реестра ($.gfx.light.occluders) и из
// собственного списка узла (.occluders([...])). Реестр наполняется из тайлмапа
// чистой функцией tileOccluders() — она не знает про движок и проверяется
// qjs-тестом, как и остальная геометрия ниже.
//
// Туман — отдельный слой: <fog> (прямоугольник в мире) и $.gfx.fog() (экранный).
// Свет с .punch(true) рисуется поверх тумана: фонарь «прорезает» дымку.
// ===========================================================================

/** Плоский список отрезков [x1,y1,x2,y2,…] в мировых координатах. */
const light_segments = [];
let light_segments_version = 0;
/** Версия реестра, под которую в C подготовлен разрезанный набор (см. polygon). */
let light_prepared_version = -1;
let light_debug = false;

// Умолчания тегов света и тумана объявляются здесь, а не в installGfx: это
// статические данные, и они должны быть видны всем, кто импортирует модуль
// (в том числе qjs-тестам без движка). Отрисовщики тегов ставит installGfx.
TAGS.lightarea = { body: null, w: 96, h: 8, radius: 220, color: '#ffcc88', intensity: 1 };
TAGS.fog = { body: null, w: 640, h: 260, color: '#9fb3c8', density: 0.4 };

/** Свет, отложенный до отрисовки тумана (.punch(true)). */
const deferred_lights = [];
/** Экранный туман: $.gfx.fog({...}), null — выключен. */
let fog_params = null;
/** Экранная темнота: $.gfx.light.ambient({...}), null — выключена. */
let ambient_params = null;
/** Lightmap: свет копится в отдельной текстуре и накладывается одним проходом. */
let lightmap_on = false;
let lightmap_intensity = 1;
let lightmap_soft = 1;

// --- Кэш границ теней и индекс препятствий ----------------------------------
// Раньше каждый свет каждый кадр перебирал ВЕСЬ реестр препятствий, хотя
// границы теней зависят только от положения источника, конфигурации веера и
// версии реестра — но не от камеры. Статический фонарь в статичной комнате
// обязан считаться один раз, а не шестьдесят раз в секунду. Отсюда две вещи:
// границы кэшируются на узле, а индекс по клеткам отдаёт свету только те
// отрезки, что попали в его радиус.
const LIGHT_BUCKET_CELL = 128;
const light_index = { version: -1, cell: 0, minx: 0, miny: 0, cols: 0, rows: 0, buckets: null };
/** Переиспользуемый буфер отобранных отрезков (плоский x1,y1,x2,y2). */
let light_cull = new Float64Array(4 * 256);
/** Отметки отрезков, уже добавленных в текущую выборку (без дублей из клеток). */
let light_cull_stamp = new Int32Array(0);
let light_cull_query = 0;
/** Счётчики за кадр: сколько границ посчитано, сколько взято из кэша, сколько отрезков дошло до света. */
const light_stats = { built: 0, cached: 0, culled: 0, considered: 0, rays: 0, cells: 0 };
/** Буферы веера: косинусы, синусы, кромка конуса. */
const fan_buf = [null, null, null];

function fanScratch(n, which) {
    let buf = fan_buf[which];
    if (!buf || buf.length < n) {
        buf = new Float64Array(Math.max(n, 128));
        fan_buf[which] = buf;
    }
    return buf;
}

/** Общие буферы расстояний и углов: без аллокаций в кадре. */
let light_dist_buf = new Float64Array(128);
function lightDistScratch(n) {
    if (light_dist_buf.length < n) light_dist_buf = new Float64Array(Math.max(n, 128));
    return light_dist_buf;
}

/** Четыре отрезка по периметру прямоугольника (x/y — левый верхний угол). */
function boxSegments(out, x, y, w, h) {
    const x2 = x + w, y2 = y + h;
    out.push(x, y, x2, y, x2, y, x2, y2, x2, y2, x, y2, x, y2, x, y);
    return out;
}

/**
 * Приводит описание препятствий к плоскому списку отрезков.
 * Понимает `[x1,y1,x2,y2]`, `{x1,y1,x2,y2}`, `{x,y,w,h}` (левый верхний угол),
 * `{cx,cy,w,h}` (центр) и вложенные массивы. Чистая функция.
 */
export function occluderSegments(list, out) {
    const dst = out || [];
    if (!list) return dst;
    // Плоский список чисел — это либо один отрезок [x1,y1,x2,y2], либо уже
    // готовый набор отрезков (так их отдаёт tileOccluders). Различаем по
    // длине: набор всегда кратен четырём, поэтому четвёрка читается однозначно.
    if (Array.isArray(list) && list.length >= 4 && typeof list[0] === 'number') {
        const count = list.length % 4 === 0 ? list.length / 4 : 1;
        for (let s = 0; s < count; s++) {
            const o = s * 4;
            dst.push(list[o], list[o + 1], list[o + 2], list[o + 3]);
        }
        return dst;
    }
    const items = Array.isArray(list) ? list : [list];
    for (const item of items) {
        if (item === null || item === undefined) continue;
        if (Array.isArray(item)) {
            if (item.length >= 4 && typeof item[0] === 'number') {
                dst.push(item[0], item[1], item[2], item[3]);
            } else {
                occluderSegments(item, dst);       // вложенный список
            }
            continue;
        }
        if (typeof item !== 'object') continue;
        if (Array.isArray(item.box)) {
            boxSegments(dst, item.box[0], item.box[1], item.box[2], item.box[3]);
        } else if (item.x1 !== undefined && item.y1 !== undefined &&
                   item.x2 !== undefined && item.y2 !== undefined) {
            dst.push(item.x1, item.y1, item.x2, item.y2);
        } else if (item.cx !== undefined && item.cy !== undefined) {
            const w = item.w === undefined ? 0 : item.w;
            const h = item.h === undefined ? 0 : item.h;
            boxSegments(dst, item.cx - w / 2, item.cy - h / 2, w, h);
        } else if (item.x !== undefined && item.y !== undefined) {
            boxSegments(dst, item.x, item.y,
                        item.w === undefined ? 0 : item.w,
                        item.h === undefined ? 0 : item.h);
        }
    }
    return dst;
}

/**
 * Препятствия из тайлмапа: наружу выходят только те рёбра непроходимых
 * тайлов, за которыми пусто. Внутренние рёбра (между двумя стенами) не нужны —
 * луч всё равно упирается во внешнюю границу, — а отрезков становится меньше
 * в разы. `isSolid(tx, ty)` — предикат непроходимости. Чистая функция.
 */
export function tileOccluders(cols, rows, isSolid, cell, ox, oy) {
    const out = [];
    const cs = cell === undefined || cell <= 0 ? 32 : cell;
    const x0 = ox || 0, y0 = oy || 0;
    const solidAt = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? false : !!isSolid(x, y);
    for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
            if (!solidAt(tx, ty)) continue;
            const left = x0 + tx * cs, right = left + cs;
            const top = y0 + ty * cs, bottom = top + cs;
            if (!solidAt(tx, ty - 1)) out.push(left, top, right, top);
            if (!solidAt(tx, ty + 1)) out.push(left, bottom, right, bottom);
            if (!solidAt(tx - 1, ty)) out.push(left, top, left, bottom);
            if (!solidAt(tx + 1, ty)) out.push(right, top, right, bottom);
        }
    }
    return out;
}

/** Пересечение луча (px,py)+(dx,dy) с отрезком: расстояние или Infinity. */
export function rayDistance(px, py, dx, dy, x1, y1, x2, y2) {
    const ex = x2 - x1, ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) return Infinity;              // параллельны
    const qx = x1 - px, qy = y1 - py;
    const t = (qx * ey - qy * ex) / den;                     // вдоль луча
    const u = (dy * qx - dx * qy) / den;                     // вдоль отрезка
    if (t < 0 || u < 0 || u > 1) return Infinity;
    return t;
}

/** Углы по кругу: последний не повторяет первый — веер замыкается сам. */
export function circleAngles(count) {
    const n = Math.max(6, Math.min(256, Math.round(count) || 6));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (i / n) * Math.PI * 2 - Math.PI;
    return out;
}

/** Углы сектора от a0 до a1: обе границы включены — это кромки конуса. */
export function sectorAngles(a0, a1, count) {
    const n = Math.max(2, Math.min(256, Math.round(count) || 2));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = a0 + (a1 - a0) * (i / (n - 1));
    return out;
}

/** Расстояние до ближайшего препятствия вдоль направления. */
function lightRayDistance(cx, cy, angle, segments, count, max_dist) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = max_dist;
    for (let s = 0; s < count; s++) {
        const o = s * 4;
        const t = rayDistance(cx, cy, dx, dy,
                              segments[o], segments[o + 1], segments[o + 2], segments[o + 3]);
        if (t < best) best = t;
    }
    return best;
}

/**
 * Расстояние до первого препятствия по каждому направлению. Чистая функция.
 *
 * `count` — сколько отрезков читать из плоского массива (по умолчанию все):
 * так сюда можно отдать переиспользуемый буфер отсечения без копии.
 * `soft` — сколько подлучей усреднять на направление. 1 — точечный источник
 * и резкая кромка тени; больше — источник конечного размера, на кромке
 * препятствия появляется полутень (цена — во столько же раз больше лучей).
 * `spread` — полуугол разброса подлучей в радианах (по умолчанию полшага
 * между лучами): им задаётся ширина полутени.
 */
export function lightBoundary(cx, cy, angles, segments, max_dist, count, soft, spread) {
    const n = angles.length;
    const out = new Float64Array(n);
    const total = segments ? Math.floor(segments.length / 4) : 0;
    const used = count === undefined ? total : Math.max(0, Math.min(count, total));
    const rays = soft === undefined ? 1 : Math.max(1, Math.min(8, Math.round(soft) || 1));
    const step = n > 1 ? Math.abs(angles[1] - angles[0]) : 0;
    const half_spread = spread === undefined ? step * 0.5 : Math.max(0, spread);
    for (let i = 0; i < n; i++) {
        const a = angles[i];
        let best;
        if (rays === 1 || half_spread <= 0) {
            best = lightRayDistance(cx, cy, a, segments, used, max_dist);
        } else {
            // Разброс — как у источника конечного размера, а не точки, поэтому
            // кромка тени размывается. Дальность каждого подлуча проецируем на
            // главное направление: иначе ровная стена перед светом «раздувалась»
            // бы, хотя полутени там нет.
            best = 0;
            for (let k = 0; k < rays; k++) {
                const off = ((k + 0.5) / rays - 0.5) * 2 * half_spread;
                best += lightRayDistance(cx, cy, a + off, segments, used, max_dist) * Math.cos(off);
            }
            best /= rays;
        }
        out[i] = best;
    }
    return out;
}

/**
 * Раскладывает плоский список отрезков по клеткам. Чистая функция — её
 * проверяют тесты без движка. Каждый отрезок попадает во все клетки своего
 * габарита, поэтому выборка по клетке никогда не теряет препятствие.
 */
export function buildLightIndex(segments, cell) {
    const cs = cell === undefined || cell <= 0 ? LIGHT_BUCKET_CELL : cell;
    const count = segments ? Math.floor(segments.length / 4) : 0;
    let minx = 0, miny = 0, maxx = 1, maxy = 1;
    if (count > 0) {
        minx = maxx = segments[0];
        miny = maxy = segments[1];
        for (let s = 0; s < count; s++) {
            const o = s * 4;
            const ax = segments[o], ay = segments[o + 1];
            const bx = segments[o + 2], by = segments[o + 3];
            if (ax < minx) minx = ax;
            if (bx < minx) minx = bx;
            if (ax > maxx) maxx = ax;
            if (bx > maxx) maxx = bx;
            if (ay < miny) miny = ay;
            if (by < miny) miny = by;
            if (ay > maxy) maxy = ay;
            if (by > maxy) maxy = by;
        }
    }
    const cols = Math.max(1, Math.floor((maxx - minx) / cs) + 1);
    const rows = Math.max(1, Math.floor((maxy - miny) / cs) + 1);
    const buckets = new Array(cols * rows);
    for (let s = 0; s < count; s++) {
        const o = s * 4;
        const clamp = (v, hi) => (v < 0 ? 0 : (v > hi ? hi : v));
        const bx0 = clamp(Math.floor((Math.min(segments[o], segments[o + 2]) - minx) / cs), cols - 1);
        const bx1 = clamp(Math.floor((Math.max(segments[o], segments[o + 2]) - minx) / cs), cols - 1);
        const by0 = clamp(Math.floor((Math.min(segments[o + 1], segments[o + 3]) - miny) / cs), rows - 1);
        const by1 = clamp(Math.floor((Math.max(segments[o + 1], segments[o + 3]) - miny) / cs), rows - 1);
        for (let by = by0; by <= by1; by++) {
            for (let bx = bx0; bx <= bx1; bx++) {
                const key = by * cols + bx;
                const list = buckets[key];
                if (list) list.push(s); else buckets[key] = [s];
            }
        }
    }
    return { cell: cs, minx, miny, cols, rows, buckets };
}

/**
 * Индексы отрезков, попавших в квадрат вокруг точки (надмножество круга —
 * лишние отсекает ограничение дальности луча). Чистая функция, без дублей.
 */
export function lightIndexPick(index, cx, cy, radius) {
    const out = [];
    if (!index || !index.buckets || !(radius > 0)) return out;
    const cs = index.cell;
    const bx0 = Math.max(0, Math.floor((cx - radius - index.minx) / cs));
    const bx1 = Math.min(index.cols - 1, Math.floor((cx + radius - index.minx) / cs));
    const by0 = Math.max(0, Math.floor((cy - radius - index.miny) / cs));
    const by1 = Math.min(index.rows - 1, Math.floor((cy + radius - index.miny) / cs));
    if (bx1 < bx0 || by1 < by0) return out;
    const seen = new Set();
    for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
            const list = index.buckets[by * index.cols + bx];
            if (!list) continue;
            for (let k = 0; k < list.length; k++) {
                const s = list[k];
                if (seen.has(s)) continue;
                seen.add(s);
                out.push(s);
            }
        }
    }
    return out;
}

/** Кромка конуса: 0 на границе, 1 внутри. `soft` — доля полуугла на растушёвку. */
export function coneAlpha(angle, a0, a1, soft) {
    const span = a1 - a0;
    if (!(span > 0)) return 1;
    const s = soft === undefined ? 0.25 : Math.max(0, Math.min(1, soft));
    const feather = Math.max(1e-9, span * 0.5 * s);
    const edge = Math.min(angle - a0, a1 - angle);
    if (edge <= 0) return 0;
    return Math.min(1, edge / feather);
}

/**
 * Полосы тумана: положение, толщина и альфа каждой. Чистая функция — от неё
 * зависит и вид тумана, и его плотность в точке, поэтому она вынесена наружу.
 */
export function fogBands(params, time, w, h) {
    const p = params || {};
    const layers = Math.max(1, Math.min(12, Math.round(p.layers === undefined ? 4 : p.layers)));
    const density = Math.max(0, Math.min(1, p.density === undefined ? 0.35 : p.density));
    const speed = p.speed === undefined ? 0.35 : p.speed;
    const amp = (p.amp === undefined ? 0.10 : p.amp) * h;
    const thickness = p.thickness === undefined ? 1.8 : p.thickness;
    const ground = p.ground === undefined ? 0 : Math.max(0, Math.min(1, p.ground));
    const bands = [];
    for (let i = 0; i < layers; i++) {
        // Золотой угол: полосы не совпадают по фазе и не «дышат» в такт.
        const phase = i * 2.39996;
        const base = ((i + 0.5) / layers) * h;
        const y = base + Math.sin((time || 0) * speed + phase) * amp;
        const bh = Math.max(1, (h / layers) * thickness);
        let alpha = density / layers;
        if (ground > 0) {
            // Приземный туман: у земли плотность полная, выше — редеет.
            const up = Math.min(1, Math.max(0, y / h));
            alpha *= 1 - ground * (1 - up) * 0.85;
        }
        bands.push({ y, h: bh, alpha, phase });
    }
    return bands;
}

/**
 * Световое пятно с границей: концентрические кольца, повторяющие контур тени.
 * Без теней и конуса расстояния постоянны — получается то же, что pushGlow.
 */
function pushLightFan(cx, cy, angles, dist, color, opts) {
    const o = opts || {};
    const rings = Math.max(1, Math.min(16, Math.round(o.rings || 7)));
    const power = o.alpha === undefined ? 1 : o.alpha;
    const alphaOf = glowAlphaCurve(o);
    const edge = typeof o.edge === 'function' ? o.edge : null;
    const closed = o.closed === true;
    const n = angles.length;
    const last = closed ? n : n - 1;

    // Косинусы, синусы и кромка конуса от кольца не зависят, а раньше
    // Math.cos/sin звались внутри цикла по кольцам — семь раз на каждый луч.
    // Считаем один раз на веер, в переиспользуемые буферы (без аллокаций).
    const cos = fanScratch(n, 0);
    const sin = fanScratch(n, 1);
    const ek = edge ? fanScratch(n, 2) : null;
    for (let i = 0; i < n; i++) {
        const a = angles[i];
        cos[i] = Math.cos(a);
        sin[i] = Math.sin(a);
        if (ek) ek[i] = edge(a);
    }

    for (let ring = 0; ring < rings; ring++) {
        const k0 = ring / rings;
        const k1 = (ring + 1) / rings;
        const a_in = power * alphaOf(k0);
        const a_out = power * alphaOf(k1);
        for (let i = 0; i < last; i++) {
            const j = (i + 1) % n;
            const e0 = ek ? ek[i] : 1;
            const e1 = ek ? ek[j] : 1;
            const c_in0 = withAlpha(color, a_in * e0);
            const c_in1 = withAlpha(color, a_in * e1);
            const c_out0 = withAlpha(color, a_out * e0);
            const c_out1 = withAlpha(color, a_out * e1);
            const cos0 = cos[i], sin0 = sin[i];
            const cos1 = cos[j], sin1 = sin[j];
            const d0 = dist[i], d1 = dist[j];
            pushTriangleGrad(cx + cos0 * d0 * k0, cy + sin0 * d0 * k0, c_in0,
                             cx + cos1 * d1 * k0, cy + sin1 * d1 * k0, c_in1,
                             cx + cos1 * d1 * k1, cy + sin1 * d1 * k1, c_out1);
            pushTriangleGrad(cx + cos0 * d0 * k0, cy + sin0 * d0 * k0, c_in0,
                             cx + cos1 * d1 * k1, cy + sin1 * d1 * k1, c_out1,
                             cx + cos0 * d0 * k1, cy + sin0 * d0 * k1, c_out0);
        }
    }
}

/** Полоса тумана: мягкий вертикальный градиент, поэтому швов не видно. */
function pushFogBand(x0, y0, w, h, color, alpha) {
    if (alpha <= 0.001 || w <= 0 || h <= 0) return;
    const clear = withAlpha(color, 0);
    const solid = withAlpha(color, alpha);
    const top = y0 - h / 2;
    const bottom = y0 + h / 2;
    pushTriangleGrad(x0, top, clear, x0 + w, top, clear, x0 + w, y0, solid);
    pushTriangleGrad(x0, top, clear, x0 + w, y0, solid, x0, y0, solid);
    pushTriangleGrad(x0, y0, solid, x0 + w, y0, solid, x0 + w, bottom, clear);
    pushTriangleGrad(x0, y0, solid, x0 + w, bottom, clear, x0, bottom, clear);
}

/** Свеча дрожит: детерминированное мерцание от игрового времени. */
function flickerFactor(node) {
    const f = node.attrs ? node.attrs.flicker : null;
    if (!f) return 1;
    const t = engine.time || 0;
    const speed = f.speed === undefined ? 7 : f.speed;
    const noise = 0.5 + 0.5 * Math.sin(t * speed) * Math.sin(t * speed * 0.37 + 1.7);
    const amount = f.amount === undefined ? 0.15 : Math.max(0, Math.min(1, f.amount));
    return 1 - amount * noise;
}

/** Отрезки для узла: свои плюс общий реестр. Кэш — по версии реестра. */
function lightSegmentsFor(node) {
    const own = node.attrs ? node.attrs.occluders : null;
    if (!own) return light_segments;
    if (node._light_seg_own === own && node._light_seg_ver === light_segments_version) {
        return node._light_seg_cache;
    }
    const segs = light_segments.slice();
    occluderSegments(own, segs);
    node._light_seg_own = own;
    node._light_seg_ver = light_segments_version;
    node._light_seg_cache = segs;
    return segs;
}

/** Индекс препятствий под текущую версию реестра. Перестраивается только при
 *  изменении реестра, а не каждый кадр. */
function lightIndexCurrent() {
    if (light_index.version !== light_segments_version || !light_index.buckets) {
        const fresh = buildLightIndex(light_segments, LIGHT_BUCKET_CELL);
        light_index.version = light_segments_version;
        light_index.cell = fresh.cell;
        light_index.minx = fresh.minx;
        light_index.miny = fresh.miny;
        light_index.cols = fresh.cols;
        light_index.rows = fresh.rows;
        light_index.buckets = fresh.buckets;
    }
    return light_index;
}

/**
 * Складывает в light_cull только те отрезки, чьи клетки попали в квадрат
 * вокруг света, и возвращает их число. Копий нет: свет читает общий буфер,
 * поэтому в кадре не появляется ни одного нового массива.
 */
function lightCollectNear(cx, cy, radius) {
    const total = Math.floor(light_segments.length / 4);
    if (total === 0) return 0;
    const idx = lightIndexCurrent();
    if (light_cull_stamp.length < total) light_cull_stamp = new Int32Array(total);
    if (light_cull.length < total * 4) light_cull = new Float64Array(total * 4);
    if (light_cull_query >= 2147483647) { light_cull_stamp.fill(0); light_cull_query = 0; }
    light_cull_query++;

    const cs = idx.cell;
    const bx0 = Math.max(0, Math.floor((cx - radius - idx.minx) / cs));
    const bx1 = Math.min(idx.cols - 1, Math.floor((cx + radius - idx.minx) / cs));
    const by0 = Math.max(0, Math.floor((cy - radius - idx.miny) / cs));
    const by1 = Math.min(idx.rows - 1, Math.floor((cy + radius - idx.miny) / cs));

    let n = 0, cells = 0;
    for (let by = by0; by <= by1; by++) {
        const row = by * idx.cols;
        for (let bx = bx0; bx <= bx1; bx++) {
            const list = idx.buckets[row + bx];
            if (!list) continue;
            cells++;
            for (let k = 0; k < list.length; k++) {
                const s = list[k];
                if (light_cull_stamp[s] === light_cull_query) continue;
                light_cull_stamp[s] = light_cull_query;
                const o = s * 4, d = n * 4;
                light_cull[d] = light_segments[o];
                light_cull[d + 1] = light_segments[o + 1];
                light_cull[d + 2] = light_segments[o + 2];
                light_cull[d + 3] = light_segments[o + 3];
                n++;
            }
        }
    }
    light_stats.culled += n;
    light_stats.considered += total;
    light_stats.cells += cells;
    return n;
}

/** Углы веера кэшируются на узле: набор меняется только вместе с конусом. */
function lightAnglesFor(node, has_cone, angle, cone_deg, cone_soft, samples) {
    const cache = node._light_angles;
    if (cache && cache.has === has_cone && cache.angle === angle &&
        cache.cone === cone_deg && cache.soft === cone_soft && cache.samples === samples) {
        return cache.angles;
    }
    const angles = has_cone
        ? sectorAngles(angle - (cone_deg * Math.PI / 180) / 2,
                       angle + (cone_deg * Math.PI / 180) / 2, samples)
        : circleAngles(samples);
    node._light_angles = { has: has_cone, angle, cone: cone_deg, soft: cone_soft, samples, angles };
    return angles;
}

/**
 * Границы теней для одной точки света, с кэшем на узле.
 *
 * Границы зависят от положения источника, веера, версии реестра и набора
 * отрезков — но не от камеры. Поэтому статический фонарь считается один раз,
 * а дальше кадр берёт готовый массив. Слот нужен площадному свету: у него
 * несколько точек-источников, и каждая кэшируется отдельно.
 */
function lightShadowSlot(node, slot, cx, cy, radius, angles, src, segments, count, soft, spread) {
    const ver = light_segments_version;
    let cache = node._light_shadow;
    if (!cache || cache.ver !== ver || cache.angles !== angles ||
        cache.src !== src || cache.soft !== soft || cache.spread !== spread || cache.r !== radius) {
        cache = node._light_shadow = { ver, angles, src, soft, spread, r: radius, xs: [], ys: [], dists: [] };
    }
    if (cache.xs[slot] === cx && cache.ys[slot] === cy && cache.dists[slot]) {
        light_stats.cached++;
        return cache.dists[slot];
    }
    const dist = lightBoundary(cx, cy, angles, segments, radius, count, soft, spread);
    cache.xs[slot] = cx;
    cache.ys[slot] = cy;
    cache.dists[slot] = dist;
    light_stats.built++;
    light_stats.rays += angles.length * soft;
    return dist;
}

/** Свет: мягкое пятно либо веер с тенями и конусом. */
function drawLightNode(node, t, cam) {
    const attrs = node.attrs || {};
    const power = node.alpha * Math.max(0, Math.min(2, node.intensity)) * flickerFactor(node);
    if (power <= 0.001) return;

    // С включённым lightmap свет уходит в свой слой: C копит его в текстуре
    // света и накладывает одним проходом, поэтому порядок света перестаёт
    // зависеть от порядка сцены.
    const prev_layer = tri_layer_cur;
    if (lightmap_on) tri_layer_cur = 1;

    const zoom = cam.zoom;
    const radius_world = Math.max(0.5, node.radius);
    const radius = Math.max(2, radius_world * zoom);
    const color = packColor(node.color);
    const cone_deg = attrs.cone === undefined ? 0 : Number(attrs.cone);
    const has_cone = cone_deg > 0 && cone_deg < 360;
    const shadows = attrs.shadows === true;
    const samples = Math.max(6, Math.min(96, Math.round(attrs.segments === undefined ? 26 : attrs.segments)));
    const rings = attrs.rings === undefined ? 7 : Math.round(attrs.rings);
    const falloff = attrs.falloff === undefined ? 2 : attrs.falloff;
    const inner = attrs.inner === undefined ? 0 : attrs.inner;
    const curve = glowAlphaCurve({ falloff, inner });

    const prev_blend = tri_blend_cur;
    tri_blend_cur = blendId(node.blend_mode);

    if (!has_cone && !shadows) {
        // Прежний вид: мягкое пятно без геометрии теней.
        pushGlow(t.x, t.y, radius, color, {
            segments: samples, rings, falloff, inner,
            alphaAt: (k) => power * curve(k),
        });
        tri_blend_cur = prev_blend;
        tri_layer_cur = prev_layer;
        return;
    }

    const cone_soft = attrs.coneSoft;
    // Мягкая кромка тени: свет как бы идёт не из точки, а из маленького диска.
    const soft = attrs.shadowSoft === undefined
        ? 1 : Math.max(1, Math.min(8, Math.round(attrs.shadowSoft) || 1));
    const soft_deg = attrs.shadowSpread === undefined ? 3 : (Number(attrs.shadowSpread) || 0);
    const soft_half = soft > 1 ? Math.max(0, soft_deg) * Math.PI / 180 / 2 : 0;
    const angles = lightAnglesFor(node, has_cone, node.angle, cone_deg, cone_soft, samples);
    const dist = lightDistScratch(angles.length);

    if (shadows) {
        const src = lightSegmentsFor(node);
        const near = lightCollectNear(node.x, node.y, radius_world);
        const world_dist = lightShadowSlot(node, 0, node.x, node.y, radius_world,
                                           angles, src, light_cull, near, soft, soft_half);
        for (let i = 0; i < angles.length; i++) {
            dist[i] = Math.min(world_dist[i], radius_world) * zoom;
        }
    } else {
        const flat = radius_world * zoom;
        for (let i = 0; i < angles.length; i++) dist[i] = flat;
    }

    const half = (cone_deg * Math.PI / 180) / 2;
    const a0 = has_cone ? node.angle - half : 0;
    const a1 = has_cone ? node.angle + half : 0;
    pushLightFan(t.x, t.y, angles, dist, color, {
        rings, falloff, inner, alpha: power, closed: !has_cone,
        edge: has_cone ? (a) => coneAlpha(a, a0, a1, cone_soft) : null,
    });
    tri_blend_cur = prev_blend;
    tri_layer_cur = prev_layer;
}

/** Площадной свет: несколько точек вдоль площадки, у каждой свой контур тени. */
function drawLightAreaNode(node, t, cam) {
    const attrs = node.attrs || {};
    const power = node.alpha * Math.max(0, Math.min(2, node.intensity)) * flickerFactor(node);
    if (power <= 0.001) return;

    // Как и у <light>: с включённым lightmap свет уходит в свой слой.
    const prev_layer = tri_layer_cur;
    if (lightmap_on) tri_layer_cur = 1;

    const zoom = cam.zoom;
    const radius_world = Math.max(0.5, node.radius);
    const samples = Math.max(1, Math.min(8, Math.round(attrs.samples === undefined ? 3 : attrs.samples)));
    const shadows = attrs.shadows === true;
    const src = shadows ? lightSegmentsFor(node) : null;
    const w = Math.abs(node.w), h = Math.abs(node.h);
    const horizontal = w >= h;
    const span = horizontal ? w : h;
    const angle_count = attrs.segments === undefined ? 20 : attrs.segments;
    const angles = lightAnglesFor(node, false, 0, 0, 0, angle_count);
    const rings = attrs.rings === undefined ? 7 : Math.round(attrs.rings);
    const falloff = attrs.falloff === undefined ? 2 : attrs.falloff;
    const inner = attrs.inner === undefined ? 0 : attrs.inner;
    const soft = attrs.shadowSoft === undefined
        ? 1 : Math.max(1, Math.min(8, Math.round(attrs.shadowSoft) || 1));

    // Все точки площадки лежат в её габарите, поэтому препятствия отсекаются
    // один раз на весь источник, а не на каждую точку.
    const near = shadows ? lightCollectNear(node.x, node.y, radius_world + span * 0.5) : 0;

    const prev_blend = tri_blend_cur;
    tri_blend_cur = blendId(node.blend_mode);
    const dist = lightDistScratch(angles.length);
    for (let i = 0; i < samples; i++) {
        const u = samples === 1 ? 0.5 : i / (samples - 1);
        const ox = horizontal ? (u - 0.5) * span : 0;
        const oy = horizontal ? 0 : (u - 0.5) * span;
        const world_dist = src
            ? lightShadowSlot(node, i, node.x + ox, node.y + oy, radius_world,
                              angles, src, light_cull, near, soft, 0)
            : null;
        for (let k = 0; k < angles.length; k++) {
            const d = world_dist ? Math.min(world_dist[k], radius_world) : radius_world;
            dist[k] = d * zoom;
        }
        pushLightFan(t.x + ox * zoom, t.y + oy * zoom, angles, dist, packColor(node.color), {
            rings, falloff, inner, alpha: power / samples, closed: true,
        });
    }
    tri_blend_cur = prev_blend;
    tri_layer_cur = prev_layer;

    // Сам источник: полоса по площади — видно, откуда идёт свет.
    if (attrs.core !== false) {
        pushSprite(engine.whiteSprite, t.x, t.y, Math.max(1, w * zoom), Math.max(1, h * zoom),
                   node.angle, withAlpha(packColor(node.color), Math.min(1, power * 0.6)),
                   attrs.blend === undefined ? 'add' : attrs.blend);
    }
}

/** Узел <fog>: прямоугольник мира, затянутый дрейфующими полосами. */
function drawFogNode(node, t, cam) {
    const attrs = node.attrs || {};
    const w = Math.abs(t.w), h = Math.abs(t.h);
    if (w <= 0 || h <= 0 || node.alpha <= 0) return;
    const color = packColor(node.color);
    const density = (attrs.density === undefined ? 0.4 : attrs.density) * node.alpha;
    const bands = fogBands({
        density, layers: attrs.layers, speed: attrs.speed, amp: attrs.amp,
        thickness: attrs.thickness, ground: attrs.ground,
    }, engine.time || 0, w, h);
    const left = t.x - w / 2;
    const top = t.y - h / 2;
    const prev_blend = tri_blend_cur;
    tri_blend_cur = blendId(node.blend_mode);
    for (const band of bands) pushFogBand(left, top + band.y, w, band.h, color, band.alpha);
    tri_blend_cur = prev_blend;
}

/** Экранный туман: $.gfx.fog({...}) — полосы через весь кадр. */
function drawGlobalFog() {
    const p = fog_params;
    const w = engine.width, h = engine.height;
    const bands = fogBands(p, engine.time || 0, w, h);
    const prev_blend = tri_blend_cur;
    tri_blend_cur = 0;
    for (const band of bands) pushFogBand(0, band.y, w, band.h, p.color, band.alpha);
    tri_blend_cur = prev_blend;
}

/**
 * Экранная темнота: multiply по всему кадру. Рисуется после мира и тумана, но
 * до света с .punch(true) — поэтому фонарь «прорезает» и дымку, и ночь.
 * level=0 ничего не гасит, level=1 даёт ровно цвет темноты (кадр × цвет).
 */
function drawGlobalAmbient() {
    const p = ambient_params;
    if (!p || !(p.level > 0)) return;
    const w = engine.width, h = engine.height;
    const a = p.level;
    const cr = (p.color >>> 16) & 0xff;
    const cg = (p.color >>> 8) & 0xff;
    const cb = p.color & 0xff;
    const color = engine.rgba(Math.round(255 + (cr - 255) * a),
                              Math.round(255 + (cg - 255) * a),
                              Math.round(255 + (cb - 255) * a), 255);
    // Именно треугольниками, а не спрайтом: спрайты уходят в свой проход и
    // рисуются до всех треугольников, поэтому темнота-спрайт гасила бы только
    // спрайты мира, а свечение фонарей (треугольники) оставалось бы нетронутым.
    // Треугольник же встаёт ровно в порядок пуша: после света и тумана мира, но
    // до света с .punch(true), который пушится следом.
    const prev = tri_blend_cur;
    tri_blend_cur = blendId('multiply');
    pushTriangle(0, 0, w, 0, w, h, color);
    pushTriangle(0, 0, w, h, 0, h, color);
    tri_blend_cur = prev;
}

/** Отладка: показать отрезки-препятствия, по которым считаются тени. */
function drawLightDebug(cam) {
    const count = Math.floor(light_segments.length / 4);
    if (count <= 0) return;
    const color = engine.rgba(255, 80, 80, 170);
    for (let s = 0; s < count; s++) {
        const o = s * 4;
        const x1 = (light_segments[o] - cam.x) * cam.zoom + cam.w / 2 + cam.shake_x;
        const y1 = (light_segments[o + 1] - cam.y) * cam.zoom + cam.h / 2 + cam.shake_y;
        const x2 = (light_segments[o + 2] - cam.x) * cam.zoom + cam.w / 2 + cam.shake_x;
        const y2 = (light_segments[o + 3] - cam.y) * cam.zoom + cam.h / 2 + cam.shake_y;
        pushLine(x1, y1, x2, y2, 1, color);
    }
}

/** Свет, отложенный до тумана: рисуется уже поверх дымки. */
function flushDeferredLights() {
    if (!deferred_lights.length) return;
    for (const item of deferred_lights) drawLightNode(item.node, item.t, item.cam);
    deferred_lights.length = 0;
}

/** Публичный API света: $.gfx.light. */
const light_api = {
    /** Заменить реестр препятствий. Возвращает число отрезков. */
    occluders(list) {
        light_segments.length = 0;
        light_segments_version++;
        return light_api.addOccluders(list);
    },
    /** Добавить препятствия к реестру. Возвращает число отрезков. */
    addOccluders(list) {
        occluderSegments(list, light_segments);
        light_segments_version++;
        return Math.floor(light_segments.length / 4);
    },
    /** Очистить реестр. */
    clearOccluders() {
        light_segments.length = 0;
        light_segments_version++;
        return 0;
    },
    /** Сколько отрезков сейчас в реестре. */
    count() { return Math.floor(light_segments.length / 4); },
    /** Копия отрезков — для отладки и тестов. */
    segments() { return light_segments.slice(); },
    /** Препятствия из тайлмапа: tileOccluders() + addOccluders(). */
    tiles(cols, rows, isSolid, opts) {
        const o = opts || {};
        return light_api.addOccluders(tileOccluders(cols, rows, isSolid, o.cell, o.x, o.y));
    },
    /** Точный полигон видимости из C (engine.light.visibility), если доступен.
     *
     * Разрезание препятствий в C — O(n^2), поэтому набор готовится один раз на
     * версию реестра (`engine.light.prepare`), а полигон считается уже по
     * разрезанному набору. Иначе каждый вызов заново резал бы все отрезки. */
    polygon(x, y) {
        if (!engine.light || typeof engine.light.visibility !== 'function') return null;
        if (!light_segments.length) return null;
        if (typeof engine.light.prepare === 'function' &&
            typeof engine.light.visibilityPrepared === 'function') {
            if (light_prepared_version !== light_segments_version) {
                light_prepared_version = light_segments_version;
                engine.light.prepare(Float32Array.from(light_segments));
            }
            return engine.light.visibilityPrepared(x, y);
        }
        return engine.light.visibility(Float32Array.from(light_segments), x, y);
    },
    /** Показать препятствия красными отрезками. */
    debug(on) { light_debug = on !== false; return light_api; },
    debugOn() { return light_debug; },
    /** Темнота поверх кадра: ambient({ level, color }), ambient.off(). */
    ambient,
    /**
     * Световая карта: { on, intensity, soft }. Свет копится в отдельной
     * текстуре половинного разрешения и накладывается на сцену одним проходом,
     * поэтому порядок света перестаёт зависеть от порядка сцены, а половинное
     * разрешение с размытием даёт мягкую кромку тени.
     */
    map(opts) {
        if (opts === undefined) {
            return { on: lightmap_on, intensity: lightmap_intensity, soft: lightmap_soft };
        }
        if (opts === null || opts.on === false) {
            lightmap_on = false;
        } else {
            lightmap_on = opts.on === undefined ? true : opts.on !== false;
            if (opts.intensity !== undefined) {
                lightmap_intensity = Math.max(0, Number(opts.intensity) || 0);
            }
            if (opts.soft !== undefined) {
                lightmap_soft = Math.max(0, Number(opts.soft) || 0);
            }
        }
        if (typeof engine.lightMap === 'function') {
            engine.lightMap(lightmap_on, lightmap_intensity, lightmap_soft);
        }
        return light_api;
    },
    /** Доступна ли световая карта в этой сборке (наличие биндинга в C). */
    mapSupported() { return typeof engine.lightMap === 'function'; },
    /** Счётчики света за кадр: посчитано границ, взято из кэша, отрезков в радиус. */
    stats() {
        return {
            built: light_stats.built,
            cached: light_stats.cached,
            culled: light_stats.culled,
            considered: light_stats.considered,
            rays: light_stats.rays,
            cells: light_stats.cells,
            occluders: Math.floor(light_segments.length / 4),
        };
    },
    /** Сбросить счётчики (например, чтобы измерить ровно один кадр). */
    resetStats() {
        light_stats.built = 0;
        light_stats.cached = 0;
        light_stats.culled = 0;
        light_stats.considered = 0;
        light_stats.rays = 0;
        light_stats.cells = 0;
        return light_api;
    },
};

/** Публичный API тумана: $.gfx.fog({...}), $.gfx.fog.off(), $.gfx.fog.params(). */
function fog(opts) {
    if (opts === undefined) return fog_params ? Object.assign({}, fog_params) : null;
    if (opts === null || opts.on === false) { fog_params = null; return fog; }
    const prev = fog_params || {};
    const pick = (key) => (opts[key] === undefined ? prev[key] : opts[key]);
    fog_params = {
        color: packColor(opts.color === undefined ? (prev.color === undefined ? '#9fb3c8' : prev.color) : opts.color),
        density: Math.max(0, Math.min(1, pick('density') === undefined ? 0.35 : pick('density'))),
        layers: pick('layers') === undefined ? 4 : pick('layers'),
        speed: pick('speed') === undefined ? 0.35 : pick('speed'),
        amp: pick('amp') === undefined ? 0.10 : pick('amp'),
        thickness: pick('thickness') === undefined ? 1.8 : pick('thickness'),
        ground: pick('ground') === undefined ? 0 : pick('ground'),
    };
    return fog;
}
fog.off = function () { fog_params = null; return fog; };
fog.params = function () { return fog_params ? Object.assign({}, fog_params) : null; };
fog.on = function () { return fog_params !== null; };

/**
 * Темнота: $.gfx.light.ambient({ level, color }).
 *
 * Свет у движка аддитивный, поэтому «сделать темнее» им нельзя — а ночь,
 * подвал или пещера нужны. Это отдельный слой: multiply поверх кадра, а свет
 * с .punch(true) рисуется уже после него и потому темноту прорезает.
 */
function ambient(opts) {
    if (opts === undefined) return ambient_params ? Object.assign({}, ambient_params) : null;
    if (opts === null || opts.on === false) { ambient_params = null; return ambient; }
    const prev = ambient_params || {};
    const level = opts.level === undefined
        ? (prev.level === undefined ? 0.5 : prev.level) : opts.level;
    ambient_params = {
        level: Math.max(0, Math.min(1, Number(level) || 0)),
        color: packColor(opts.color === undefined
            ? (prev.color === undefined ? '#000000' : prev.color) : opts.color),
    };
    return ambient;
}
ambient.off = function () { ambient_params = null; return ambient; };
ambient.params = function () { return ambient_params ? Object.assign({}, ambient_params) : null; };
ambient.on = function () { return ambient_params !== null; };

// ---------------------------------------------------------------------------
// Отрисовка узла
// ---------------------------------------------------------------------------

// Переиспользуемый прямоугольник узла на экране. Объект {x,y,w,h} на каждый
// узел каждый кадр — это 1000 malloc в QuickJS (§3.4, пункт 10 плана), поэтому
// встроенные теги получают общий объект. Свой объект отдаётся только чужим
// отрисовщикам (`registerNodeRenderer`) и отложенному свету — они вправе
// сохранить его себе.
const scratch_t = { x: 0, y: 0, w: 0, h: 0 };

function nodeTransform(node, cam, out) {
    let sx = (node.x - cam.x) * cam.zoom + cam.w / 2 + cam.shake_x;
    let sy = (node.y - cam.y) * cam.zoom + cam.h / 2 + cam.shake_y;
    if (node.shake_timer > 0) {
        const p = node.shake_total > 0 ? node.shake_timer / node.shake_total : 1;
        const amp = node.shake_amount * p;
        sx += (fxRandom() * 2 - 1) * amp;
        sy += (fxRandom() * 2 - 1) * amp;
    }
    const t = out || { x: 0, y: 0, w: 0, h: 0 };
    t.x = sx;
    t.y = sy;
    t.w = node.w * node.scale_x * cam.zoom;
    t.h = node.h * node.scale_y * cam.zoom;
    return t;
}

/** Копия прямоугольника для тех, кто оставляет его себе (отложенный свет). */
function copyTransform(t) { return { x: t.x, y: t.y, w: t.w, h: t.h }; }

function baseColor(node) {
    let color = node.tint && node.tint_timer > 0 ? node.tint : node.color;
    if (node.alpha < 1) color = withAlpha(color, node.alpha);
    return color;
}

/**
 * Габарит текстового узла: у <text> нет спрайта, поэтому w/h равны нулю, и
 * отсечение по камере (и сортировка) считали бы его невидимым. Меряем строку
 * тем же шрифтом, которым рисуем, и запоминаем — пересчёт только при смене
 * текста, кегля или семейства.
 */
function syncTextBounds(node) {
    const size = numOf(node.size, 20);
    const family = nodeFontFamily(node) || '';
    const key = node.text + '|' + size + '|' + family;
    if (node._text_measure_key === key) return;
    node._text_measure_key = key;

    const measured = typeof engine.measureText === 'function'
        ? engine.measureText(String(node.text), size, family)
        : null;
    const w = measured ? Number(measured[0]) || 0 : 0;
    const h = measured ? Number(measured[1]) || 0 : size;
    node.w = w;
    node.h = h;
}

function numOf(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Сдвигает прямоугольник узла под его пивот. Спрайт в C вращается вокруг
 * СВОЕГО центра, поэтому чтобы вращение шло вокруг пивота (например, у ног
 * персонажа), центр квада уезжает на (0.5 − pivot) от точки узла.
 *
 * Без пивота (0.5, 0.5 — значение по умолчанию) сдвига нет, то есть прежнее
 * поведение сохраняется.
 */
function applyPivot(node, t) {
    const px = node.pivot_x === undefined ? 0.5 : node.pivot_x;
    const py = node.pivot_y === undefined ? 0.5 : node.pivot_y;
    if (px === 0.5 && py === 0.5) return;
    t.x += (0.5 - px) * t.w;
    t.y += (0.5 - py) * t.h;
}


/**
 * Nine-slice: спрайт режется на 9 частей по `insets` и растягивается под
 * размер узла — углы остаются целыми, края тянутся, центр заполняет.
 * Применяется к стенам, панелям, рамкам кнопок и любым «резиновым» картинкам.
 */
function drawSlicedSprite(node, t, color) {
    const spec = node.nine_slice;
    const sprite = node.sprite >= 0 ? node.sprite : engine.whiteSprite;
    const size = spriteSize(sprite);
    const srcW = size[0] > 0 ? size[0] : t.w;
    const srcH = size[1] > 0 ? size[1] : t.h;

    const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
    // Инсеты: числа 0..1 — доля стороны, больше 1 — пиксели исходного спрайта.
    const pick = (value, along) => {
        const v = Number(value) || 0;
        return v > 0 && v <= 1 ? v * along : v;
    };
    const l = Math.min(clamp(pick(spec.left, srcW), 0, srcW / 2), srcW / 2);
    const r = Math.min(clamp(pick(spec.right, srcW), 0, srcW / 2), srcW / 2);
    const top = Math.min(clamp(pick(spec.top, srcH), 0, srcH / 2), srcH / 2);
    const bot = Math.min(clamp(pick(spec.bottom, srcH), 0, srcH / 2), srcH / 2);

    // Размеры кусков вдоль каждой оси: [начало, середина, конец].
    const cols = [l, Math.max(0, srcW - l - r), r];
    const rows = [top, Math.max(0, srcH - top - bot), bot];
    const sx = [0, l, srcW - r];
    const sy = [0, top, srcH - bot];

    // Размеры назначения: края в пикселях, середина — остаток. Если места
    // меньше суммы краёв, они ужимаются пропорционально (иначе части налезут).
    const needX = l + r;
    const needY = top + bot;
    const dstW = Math.abs(t.w);
    const dstH = Math.abs(t.h);
    const kx = needX > 0 && needX > dstW ? dstW / needX : 1;
    const ky = needY > 0 && needY > dstH ? dstH / needY : 1;
    const dw = [cols[0] * kx, Math.max(0, dstW - (l + r) * kx), cols[2] * kx];
    const dh = [rows[0] * ky, Math.max(0, dstH - (top + bot) * ky), rows[2] * ky];

    const x0 = t.x - dstW / 2;
    const y0 = t.y - dstH / 2;

    for (let row = 0; row < 3; ++row) {
        if (dh[row] <= 0 && rows[row] > 0) continue;
        for (let col = 0; col < 3; ++col) {
            if (dw[col] <= 0 && cols[col] > 0) continue;
            const part = regionSprite(node.attrs.src, sx[col], sy[row], cols[col], rows[row]);
            if (part < 0) continue;
            const px = col === 0 ? x0 : (col === 1 ? x0 + dw[0] : x0 + dw[0] + dw[1]);
            const py = row === 0 ? y0 : (row === 1 ? y0 + dh[0] : y0 + dh[0] + dh[1]);
            pushSprite(part, px + dw[col] / 2, py + dh[row] / 2,
                       dw[col], dh[row], t.angle || 0, color, node.blend_mode,
                       fxIndexOf(node));
        }
    }
}

function drawWorldNode(node, cam) {
    if (!node.visible || node.alpha <= 0) return;

    // Тексту нечего рисовать, кроме строки: его габарит считаем до отсечения.
    if (node.tag === 'text' && node.text) syncTextBounds(node);

    // Свои теги рисует модуль. Проверяем до отсечения: у <tilemap> и
    // <particles> собственный габарит, который общий прямоугольник узла не
    // описывает, и модуль отсекает себя сам, если умеет.
    // Чужой отрисовщик вправе сохранить прямоугольник — ему отдаём свой объект,
    // встроенным тегам хватает переиспользуемого.
    const custom = node_renderers.get(node.tag);
    const t = custom ? nodeTransform(node, cam) : nodeTransform(node, cam, scratch_t);

    if (custom) {
        state.stats.nodes++;
        custom(node, t, cam);
        return;
    }

    applyPivot(node, t);

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
        //
        // С .shadows(true) и .cone(deg) пятно строится по границе теней
        // (см. drawLightNode), а с .punch(true) — откладывается до тумана.
        if (node.attrs.punch && (fog_params || (ambient_params && ambient_params.level > 0))) {
            deferred_lights.push({ node, t: copyTransform(t), cam });
            break;
        }
        drawLightNode(node, t, cam);
        break;
    }
    case 'text': {
        ctx.gfx._queueTextScaled(node.text, t.x, t.y, node.size, baseColor(node),
                                 node.attrs.align || 'left', nodeFontFamily(node),
                                 node.angle, cam.zoom);
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

        if (node.nine_slice) {
            drawSlicedSprite(node, t, baseColor(node));
            break;
        }

        pushSprite(sprite, t.x, t.y, t.w, t.h, node.angle, baseColor(node), node.blend_mode,
                   fxIndexOf(node));
        break;
    }
    }
}

/** Семейство шрифта узла: сам узел, ближайший предок или шрифт по умолчанию. */
function nodeFontFamily(node) {
    for (let cur = node; cur; cur = cur.parent_node) {
        const family = cur.attrs && cur.attrs.font;
        if (family) return family;
    }
    return undefined;
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
            ctx.gfx._queueText(node.text, node.x, node.y, node.size, node.text_color, 'center',
                               nodeFontFamily(node));
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
                           node.attrs.align || 'left', nodeFontFamily(node));
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

// Список узлов мира переиспользуется между кадрами, а результат сортировки
// живёт, пока заведомо верен: состав не менялся (версия реестра) и поpядок всё
// ещё неубывающий. Проверка порядка — O(N) сравнений против O(N log N) сортировки
// с интерпретируемым компаратором: на 1000 спрайтов это ≈2,7 мс кадра
// (docs/HIGH_LEVEL_API_PERF.md §3.4, пункт 9 плана).
let sorted_list = [];
let sorted_version = -1;
let sorted_total = -1;
let sorted_mode = null;

/** Компараторы уровня модуля: замыкание на кадр раньше аллоцировалось каждый раз. */
function compareByLayer(a, b) {
    if (a.layer !== b.layer) return a.layer - b.layer;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.uid - b.uid;
}

function compareByY(a, b) {
    if (a.layer !== b.layer) return a.layer - b.layer;
    if (a.y !== b.y) return a.y - b.y;
    return a.uid - b.uid;
}

function isOrdered(list, compare) {
    for (let i = 1; i < list.length; i++) {
        if (compare(list[i - 1], list[i]) > 0) return false;
    }
    return true;
}

function sortedNodes() {
    const world = ctx.world;
    const mode = world ? world._state.sort_mode : 'layer';
    const fn = world ? world._state.sort_fn : null;
    const ui = facetCount('ui');
    const total = ctx.nodes.length - ui;

    // Кэш годится, если состав реестра не менялся и массив всё ещё неубывающий.
    // Второе условие — полная проверка корректности: если порядок не нарушен,
    // результат совпадает с тем, что дала бы сортировка (компаратор — полный
    // порядок с добивкой по uid), а смена layer/depth без нарушения порядка
    // ничего не меняет.
    if (!fn && sorted_version === registryVersion() && sorted_total === total
        && sorted_mode === mode) {
        const compare = mode === 'y' ? compareByY : compareByLayer;
        if (isOrdered(sorted_list, compare)) return sorted_list;
    }

    sorted_list.length = 0;
    const nodes = ctx.nodes;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node.removed && !node.attrs.ui) sorted_list.push(node);
    }
    if (fn) { sorted_list.sort(fn); }
    else sorted_list.sort(mode === 'y' ? compareByY : compareByLayer);
    sorted_version = registryVersion();
    sorted_total = sorted_list.length;
    sorted_mode = mode;
    return sorted_list;
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

        /** Виды шейдеров узла: flash, dissolve, chroma, wave (+ none). */
        fxKinds() { return fxKinds(); },

        /**
         * Скомпилировать свой фрагментный шейдер прямо в игре.
         *
         *   $.gfx.defineShader('scanline', `
         *       void main() {
         *           vec2 uv = v_texcoord;
         *           float g = step(0.5, fract(uv.y * 60.0));
         *           o_color = texture(u_texture, uv) * v_color * (0.6 + 0.4 * g);
         *       }`);
         *   $('#tv').shader('scanline');
         *
         * Шапку с привязками движок подставляет сам (см. shaderPreamble()).
         * Параметры передаются через .shaderParam / .shader(name, params) как
         * `p1`, `p2`, `p3` (vec4 u.p) и `color` (vec4 u.c). Возвращает `true`,
         * если шейдер скомпилировался; причину отказа видно в shaderError().
         */
        defineShader(name, source) {
            // Встроенные имена заняты: иначе свой шейдер молча перекрыл бы
            // 'flash' и разница была бы видна только по картинке.
            if (FX_KINDS[String(name)] !== undefined) {
                user_shader_error = `$.gfx.defineShader("${name}"): имя занято встроенным эффектом`;
                ctx.log('$: ' + user_shader_error);
                return false;
            }
            const problem = userShaderBodyError(source);
            if (problem) {
                user_shader_error = `$.gfx.defineShader("${name}"): ${problem}`;
                ctx.log('$: ' + user_shader_error);
                return false;
            }
            if (typeof engine.defineUserShader !== 'function') {
                user_shader_error = 'движок без компилятора шейдеров';
                ctx.log('$: ' + user_shader_error);
                return false;
            }
            const id = Number(engine.defineUserShader(String(name), source));
            if (!(id > 0)) {
                user_shader_error = String(engine.userShaderError ? engine.userShaderError() : '');
                ctx.log(`$: шейдер "${name}" не скомпилировался — ${user_shader_error}`);
                return false;
            }
            user_shaders.set(String(name), id);
            user_shader_error = '';
            return true;
        },

        /** Имена зарегистрированных пользовательских шейдеров. */
        userShaders() { return Array.from(user_shaders.keys()); },

        /** Последняя ошибка компиляции шейдера (пустая строка — ошибок нет). */
        shaderError() { return user_shader_error; },

        /** Поддерживает ли сборка компиляцию шейдеров в рантайме. */
        shadersSupported() {
            return typeof engine.userShadersSupported === 'function'
                ? !!engine.userShadersSupported()
                : false;
        },

        /** Шапка, которую движок подставляет перед телом шейдера. */
        shaderPreamble() {
            return typeof engine.userShaderPreamble === 'function'
                ? String(engine.userShaderPreamble())
                : '';
        },

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

            /**
             * Спрайт поверх всего: `x`/`y` — ЛЕВЫЙ ВЕРХНИЙ угол в координатах
             * окна, как у `rect`/`line`/`circle` этого же объекта.
             *
             * `opts`: `alpha`, `color`, `angle` (радианы), `blend`
             * (`'alpha'` по умолчанию), `w`/`h` — синонимы размеров.
             *
             * ```js
             * const trail = $.viewport.create(800, 600);
             * $.gfx.draw.sprite($.viewport.sprite(trail), 0, 0, 800, 600, { alpha: 0.9 });
             * ```
             */
            sprite(sprite, x, y, w, h, opts) {
                const o = opts || {};
                const nn = (value, fallback) => {
                    if (value === null || value === undefined || value === '') return fallback;
                    const v = Number(value);
                    return Number.isFinite(v) ? v : fallback;
                };
                const id = nn(sprite, -1);
                if (id < 0) return false;
                // Размер не задан — отдаём 0, C подставит размер самого спрайта
                // (см. `engine.submitSprites`: `w <= 0` → размер спрайта).
                const sw = nn(o.w !== undefined ? o.w : w, 0);
                const sh = nn(o.h !== undefined ? o.h : h, 0);
                const color = o.color !== undefined
                    ? packColor(o.color, o.alpha)
                    : (o.alpha !== undefined ? packColor('#ffffff', o.alpha) : 0xffffffff);
                const blend = o.blend === undefined ? default_blend : o.blend;
                // Как glow: примитивы этого объекта живут в координатах окна,
                // а pushSprite ожидает мировые — подменяем вид на камеру.
                const prev_view = view;
                setView(cameraTransform());
                pushSprite(id, nn(x, 0) + sw / 2, nn(y, 0) + sh / 2,
                           sw, sh, nn(o.angle, 0), color, blend);
                view = prev_view;
                return true;
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
                           packColor(o.color, o.alpha), o.align || 'left',
                           o.font, o.angle);
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
                          'saturation', 'contrast', 'brightness', 'blood',
                          'bloom_threshold', 'bloom_radius'];
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
        /**
         * Текст в общий батч кадра. `family` — имя семейства шрифта (см.
         * `$.font`), `angle` — поворот вокруг точки привязки в радианах.
         * Текст идёт обычными спрайтами, поэтому подчиняется порядку
         * отрисовки, режимам смешивания и пост-обработке.
         */
        _queueText(text, x, y, size, color, align, family, angle) {
            state.stats.texts++;
            engine.drawText(text, x, y, size, color, align || 'left',
                            family || nodeFontFamily(null),
                            angle || 0);
        },

        /**
         * Текст в сцене: ядро рисует строку спрайтами, но растеризует глифы
         * под МИРОВОЙ кегль, а зум камеры применяет как масштаб. Иначе каждый
         * пиксель зума пёк бы новый кегль в атлас (см. src/font.c).
         */
        _queueTextScaled(text, x, y, size, color, align, family, angle, scale) {
            state.stats.texts++;
            const zoom = scale && scale > 0 ? scale : 1;
            engine.drawText(text, x, y, size, color, align || 'left',
                            family || nodeFontFamily(null),
                            angle || 0, zoom);
        },

        // --- Кадр ------------------------------------------------------------
        _render() {
            const cam = cameraTransform();
            // Зерну нужно текущее время, поэтому параметры поста уходят в
            // движок каждый кадр, даже если игра их не меняла.
            pushPost();
            // Режим световой карты синхронизируем каждый кадр: по нему C решает,
            // рисовать свет в текстуру или прямо в сцену.
            if (typeof engine.lightMap === 'function') {
                engine.lightMap(lightmap_on, lightmap_intensity, lightmap_soft);
            }
            state.stats = { sprites: 0, triangles: 0, texts: 0, nodes: 0 };
            count = 0;
            tri_count = 0;
            tri_blend_cur = 0;
            // Счётчики света — за кадр: по ним видно, что статический свет
            // берётся из кэша, а не считается заново (см. $.gfx.light.stats()).
            light_stats.built = 0;
            light_stats.cached = 0;
            light_stats.culled = 0;
            light_stats.considered = 0;
            light_stats.rays = 0;
            light_stats.cells = 0;
            // Таблица шейдеров узлов собирается заново: параметры (например,
            // фаза волны) меняются каждый кадр.
            fx_map.clear();
            fx_count = 0;

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
            // Обход по индексу и вынесенный хук: for-of заводит итератор, а
            // ctx.gfx._ysortFlush читался бы на каждом узле.
            const flush = ctx.gfx._ysortFlush;
            const total = list.length;
            if (flush) {
                for (let i = 0; i < total; i++) {
                    const node = list[i];
                    flush(cam, node.y);
                    drawWorldNode(node, cam);
                }
            } else {
                for (let i = 0; i < total; i++) drawWorldNode(list[i], cam);
            }
            if (ctx.gfx._ysortFlushEnd) ctx.gfx._ysortFlushEnd(cam);

            // Туман и отложенный свет. Узлы <fog> уже нарисованы в общем
            // проходе, здесь — экранный $.gfx.fog(); поверх дымки идёт свет,
            // помеченный .punch(true): фонарь «прорезает» туман.
            if (light_debug) drawLightDebug(cam);
            if (fog_params) drawGlobalFog();
            // Темнота — после тумана: ночь гасит и дымку, а свет с .punch(true)
            // рисуется уже после неё и потому прорезает и туман, и темноту.
            drawGlobalAmbient();
            flushDeferredLights();

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
                    ctx.gfx._queueText(call.text, call.x, call.y, call.size, call.color, call.align,
                                       call.font);
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

            // Интерфейс — в координатах окна, камера не влияет. Срез ui-узлов
            // держит индекс реестра: второго полного прохода за кадр нет
            // (§3.4, пункт 11 и §5, P2 отчёта).
            const ui_start = count;
            const ui_list = nodesWithFacet('ui');
            for (let i = 0; i < ui_list.length; i++) drawUINode(ui_list[i]);
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
            state.stats.raw_count = count;
            state.stats.raw_texts = state.stats.texts;
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

    // --- Свет и туман -------------------------------------------------------
    // Умолчания тегов <lightarea> и <fog> объявлены на уровне модуля (см.
    // раздел «Свет в стиле Candle»): здесь только их отрисовщики.
    registerNodeRenderer('lightarea', (node, t, cam) => drawLightAreaNode(node, t, cam));
    registerNodeRenderer('fog', (node, t, cam) => drawFogNode(node, t, cam));

    // Методы света на обёртке узла. Имена не пересекаются с ядром: у спрайта
    // .shadow() — это тень-копия, а .shadows() — тени самого света.
    def('shadows', function (on) {
        if (on === undefined) return this.nodes.length ? !!this.nodes[0].attrs.shadows : false;
        return this.eachNode((_, el) => { (el).attrs.shadows = on !== false; });
    });
    def('cone', function (deg, soft) {
        if (deg === undefined) return this.nodes.length ? this.nodes[0].attrs.cone : undefined;
        return this.eachNode((_, el) => {
            const node = el;
            node.attrs.cone = Math.max(0, Math.min(360, Number(deg) || 0));
            if (soft !== undefined) node.attrs.coneSoft = Math.max(0, Math.min(1, Number(soft)));
        });
    });
    def('punch', function (on) {
        if (on === undefined) return this.nodes.length ? !!this.nodes[0].attrs.punch : false;
        return this.eachNode((_, el) => { (el).attrs.punch = on !== false; });
    });
    def('flicker', function (amount, speed) {
        if (amount === undefined) return this.nodes.length ? this.nodes[0].attrs.flicker : null;
        return this.eachNode((_, el) => {
            const node = el;
            node.attrs.flicker = (amount === false || amount === null) ? null : {
                amount: Math.max(0, Math.min(1, Number(amount))),
                speed: speed === undefined ? 7 : Number(speed),
            };
        });
    });
    def('occluders', function (list) {
        if (list === undefined) return this.nodes.length ? this.nodes[0].attrs.occluders : null;
        return this.eachNode((_, el) => { (el).attrs.occluders = list; });
    });
    // Мягкая кромка тени: подлучи на направление. 1 — резкая кромка (как было),
    // больше — источник конечного размера и полутень. Цена растёт во столько же
    // раз, но у статического света границы считаются один раз.
    def('shadowSoft', function (rays, spreadDeg) {
        if (rays === undefined) {
            return this.nodes.length ? (this.nodes[0].attrs.shadowSoft || 1) : 1;
        }
        const n = (rays === false || rays === null) ? 1
            : Math.max(1, Math.min(8, Math.round(Number(rays) || 1)));
        const spread = spreadDeg === undefined ? undefined
            : Math.max(0, Math.min(90, Number(spreadDeg) || 0));
        return this.eachNode((_, el) => {
            const node = el;
            node.attrs.shadowSoft = n;
            if (spread !== undefined) node.attrs.shadowSpread = spread;
        });
    });

    gfx.light = light_api;
    gfx.fog = fog;

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
