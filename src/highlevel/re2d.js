// ===========================================================================
// Re2D — 2.5D как дополнение к 2D (docs/RE2D.md).
//
// Мир остаётся плоским: позиция, размер, тело и слои узла — обычные 2D-поля.
// Re2D добавляет ВИД на этот мир: камеру от первого лица (camera.js) и
// отрисовщики узлов вида 're2d'. Перспективу считает C (engine.re2d.*), здесь
// только сбор сцены и вызов пакетных нативных примитивов.
//
//   $.camera.kind(Re2D).eye(48).fov(70).mouseLook(true);
//   $.re2d.room({ x: 0, y: 0, w: 1280, h: 1280, wall: 'art/brick.png', floor: 'art/floor.png' });
//   $('<player>', { id: 'hero' }).at(640, 1100).kind(Re2D).appendTo($.world);
//   $.camera.follow('#hero');
//
// Как рисуется кадр. Когда камера имеет вид 're2d', render.js не рисует 2D-мир, а
// вызывает проход вида: begin(cam) → отрисовщик каждого Re2D-узла → end(cam).
// Узлы-поверхности (<wall>, <floor>, <ceiling>) не рисуются по одному: их
// треугольники копятся в вёдрах по (текстура, режим граней) и уходят в
// engine.re2d.mesh одним вызовом на ведро — z-буфер движка сам разбирает, что
// ближе. Геометрия узла строится один раз и кэшируется до смены его полей.
// ===========================================================================

import { TAGS } from './core.js';
import { registerKindPass, registerKindRenderer, KIND_RE2D } from './kinds.js';
import { applyRe2dView } from './camera.js';

/** Высота стен и потолка по умолчанию (пиксели мира); у глаз по умолчанию 48. */
export const DEFAULT_HEIGHT = 256;

/** Сторона тайла текстуры по умолчанию: через столько единиц мира текстура повторяется. */
export const DEFAULT_TILE = 64;

/**
 * Предел ячеек на сторону грани. Грань нарезается на ячейки, потому что
 * текстуры меша аффинные (без деления на глубину), а крупная ячейка кривит
 * картинку; предел защищает от случайного миллиона треугольников.
 */
const MAX_CELLS = 96;

const FLOATS = 8;                 // x, y, z, u, v, r, g, b
const CELL_FLOATS = 6 * FLOATS;   // ячейка — два треугольника

/** Сколько ячеек нужно, чтобы покрыть длину тайлами (не меньше 1, не больше предела). */
export function cellsFor(length, tile) {
    const n = Math.ceil(Math.abs(length) / (tile > 0 ? tile : DEFAULT_TILE));
    return Math.max(1, Math.min(MAX_CELLS, n));
}

/** Упакованный RGBA узла → [r, g, b] в 0..255 (little-endian, красный — младший байт). */
export function unpackRgb(color) {
    const c = color >>> 0;
    return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
}

// Одна вершина меша → в массив.
function vert(out, o, p, rgb) {
    out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = p[3]; out[o + 4] = p[4];
    out[o + 5] = rgb[0]; out[o + 6] = rgb[1]; out[o + 7] = rgb[2];
}

// Ячейка из четырёх углов (в порядке BL, BR, TR, TL) → два треугольника
// TL-TR-BR и TL-BR-BL. Для вертикальной грани «снизу-слева…» считается с точки
// зрения зрителя СНАРУЖИ: такой обход на экране идёт по часовой стрелке и
// считается лицевым (src/re2d_math.h).
function cell(out, o, bl, br, tr, tl, rgb) {
    vert(out, o, tl, rgb);
    vert(out, o + 8, tr, rgb);
    vert(out, o + 16, br, rgb);
    vert(out, o + 24, tl, rgb);
    vert(out, o + 32, br, rgb);
    vert(out, o + 40, bl, rgb);
    return o + CELL_FLOATS;
}

/**
 * Горизонтальная плоскость x0..x1 × y0..y1 на высоте z, нарезанная на ячейки по
 * тайлу. Каждая ячейка берёт прямоугольник текстуры целиком (uv = {u0, v0, u1,
 * v1}), поэтому текстура повторяется. Пишет в `out` с позиции `o` (в float),
 * возвращает новую позицию.
 */
export function pushPlane(out, o, x0, y0, x1, y1, z, tile, uv, rgb) {
    const nx = cellsFor(x1 - x0, tile);
    const ny = cellsFor(y1 - y0, tile);
    for (let j = 0; j < ny; j++) {
        const ya = y0 + (y1 - y0) * j / ny, yb = y0 + (y1 - y0) * (j + 1) / ny;
        for (let i = 0; i < nx; i++) {
            const xa = x0 + (x1 - x0) * i / nx, xb = x0 + (x1 - x0) * (i + 1) / nx;
            o = cell(out, o,
                [xa, yb, z, uv.u0, uv.v1], [xb, yb, z, uv.u1, uv.v1],
                [xb, ya, z, uv.u1, uv.v0], [xa, ya, z, uv.u0, uv.v0], rgb);
        }
    }
    return o;
}

/**
 * Вертикальная грань: по полу от точки bl к точке br (смотря на грань снаружи
 * bl — слева, br — справа), по высоте от z0 до z1. Нарезка по тайлу в обе стороны.
 */
export function pushWall(out, o, blx, bly, brx, bry, z0, z1, tile, uv, rgb) {
    const nx = cellsFor(Math.hypot(brx - blx, bry - bly), tile);
    const nz = cellsFor(z1 - z0, tile);
    for (let j = 0; j < nz; j++) {
        const za = z0 + (z1 - z0) * j / nz, zb = z0 + (z1 - z0) * (j + 1) / nz;
        for (let i = 0; i < nx; i++) {
            const ta = i / nx, tb = (i + 1) / nx;
            const xa = blx + (brx - blx) * ta, ya = bly + (bry - bly) * ta;
            const xb = blx + (brx - blx) * tb, yb = bly + (bry - bly) * tb;
            o = cell(out, o,
                [xa, ya, za, uv.u0, uv.v1], [xb, yb, za, uv.u1, uv.v1],
                [xb, yb, zb, uv.u1, uv.v0], [xa, ya, zb, uv.u0, uv.v0], rgb);
        }
    }
    return o;
}

/**
 * Четыре боковые грани прямоугольной призмы. Углы граней заданы для зрителя
 * СНАРУЖИ каждой грани: «вправо» от зрителя на грани с внешней нормалью n —
 * это (n.y, -n.x). Поэтому изнутри комнаты, собранной из таких плит, видны
 * внутренние грани, а внешние отбраковываются по обходу.
 */
export function pushPrism(out, o, x0, y0, x1, y1, z0, z1, tile, uv, rgb) {
    o = pushWall(out, o, x1, y1, x1, y0, z0, z1, tile, uv, rgb);   // восток  (+x)
    o = pushWall(out, o, x0, y0, x0, y1, z0, z1, tile, uv, rgb);   // запад   (-x)
    o = pushWall(out, o, x0, y1, x1, y1, z0, z1, tile, uv, rgb);   // юг      (+y)
    o = pushWall(out, o, x1, y0, x0, y0, z0, z1, tile, uv, rgb);   // север   (-y)
    return o;
}

/** Сколько float займёт горизонтальная плоскость. */
export function planeFloats(w, h, tile) {
    return cellsFor(w, tile) * cellsFor(h, tile) * CELL_FLOATS;
}

/** Сколько float займёт призма (четыре грани). */
export function prismFloats(w, h, height, tile) {
    return (2 * cellsFor(h, tile) + 2 * cellsFor(w, tile)) * cellsFor(height, tile) * CELL_FLOATS;
}

// --- Кэш геометрии узла -----------------------------------------------------

const WHITE_UV = { u0: 0, v0: 0, u1: 1, v1: 1 };
const geometry = new WeakMap();   // узел → { sig, verts, count, texture, cull }

// Верх поверхности (абсолютная высота): атрибут `top`, иначе основание +
// высота по умолчанию. Не `height`: в конструкторе узла это имя занято
// размером спрайта (`h`), и значение ушло бы не туда.
function topOf(node, base) {
    const top = Number(node.attrs.top);
    return top > base ? top : base + DEFAULT_HEIGHT;
}

function tileOf(node, textured) {
    const t = Number(node.attrs.tile);
    if (t > 0) return t;
    // Без текстуры повторять нечего: грубая нарезка, лишь бы туман шёл гладко.
    return textured ? DEFAULT_TILE : DEFAULT_TILE * 4;
}

// Текстура и её прямоугольник по спрайту узла; null — узел без картинки.
function textureOf(node) {
    if (node.sprite === undefined || node.sprite < 0) return null;
    const info = engine.re2d.sprite(node.sprite);
    return info && info.texture >= 0 ? info : null;
}

function signature(node, info) {
    return `${node.tag}|${node.x}|${node.y}|${node.w}|${node.h}|${node.depth}|${node.attrs.top}|${node.attrs.tile}|${node.color}|${info ? info.texture + ':' + info.u0 + ':' + info.v0 : -1}`;
}

/** Строит (или берёт из кэша) геометрию поверхности: { verts, count, texture, cull }. */
function surfaceOf(node) {
    const info = textureOf(node);
    const sig = signature(node, info);
    const cached = geometry.get(node);
    if (cached !== undefined && cached.sig === sig) return cached;

    const rgb = unpackRgb(node.color);
    const tile = tileOf(node, info !== null);
    const uv = info !== null ? info : WHITE_UV;
    const x0 = node.x - node.w / 2, x1 = node.x + node.w / 2;
    const y0 = node.y - node.h / 2, y1 = node.y + node.h / 2;
    const base = Number(node.depth) || 0;       // высота основания (у узла это .depth)
    let verts, o = 0, cull = false;

    if (node.tag === 'wall') {
        const top = topOf(node, base);
        verts = new Float32Array(prismFloats(node.w, node.h, top - base, tile));
        o = pushPrism(verts, 0, x0, y0, x1, y1, base, top, tile, uv, rgb);
        cull = true;
    } else {
        // <floor> лежит на высоте основания, <ceiling> — на высоте `top`.
        const z = node.tag === 'ceiling' ? topOf(node, base) : base;
        verts = new Float32Array(planeFloats(node.w, node.h, tile));
        o = pushPlane(verts, 0, x0, y0, x1, y1, z, tile, uv, rgb);
    }
    const entry = { sig, verts, count: o / FLOATS, texture: info !== null ? info.texture : -1, cull };
    geometry.set(node, entry);
    return entry;
}

// --- Вёдра кадра ---------------------------------------------------------------

// Ведро — все треугольники одной текстуры и одного режима граней. Буфер
// переиспользуется между кадрами: растёт, но не сжимается.
const buckets = new Map();
let surfacesDrawn = 0;

function bucketFor(texture, cull) {
    const key = (texture + 1) * 2 + (cull ? 1 : 0);
    let b = buckets.get(key);
    if (b === undefined) {
        b = { texture, cull, buf: new Float32Array(16384), len: 0 };
        buckets.set(key, b);
    }
    return b;
}

function appendTo(bucket, verts) {
    const need = bucket.len + verts.length;
    if (need > bucket.buf.length) {
        let size = bucket.buf.length;
        while (size < need) size *= 2;
        const grown = new Float32Array(size);
        grown.set(bucket.buf.subarray(0, bucket.len));
        bucket.buf = grown;
    }
    bucket.buf.set(verts, bucket.len);
    bucket.len = need;
}

/** Нарисовать поверхность: добавить её треугольники в нужное ведро кадра. */
function drawSurface(node, cam) {
    // Потолок виден только изнутри: из 2D-камеры сверху он закрыл бы весь пол.
    if (cam.kind !== KIND_RE2D) return node.tag === 'ceiling';
    const g = surfaceOf(node);
    if (g.count > 0) {
        appendTo(bucketFor(g.texture, g.cull), g.verts);
        surfacesDrawn++;
    }
    return true;
}

// Какие теги умеет рисовать вид; остальные под Re2D-камерой пропускаются.
const DRAWERS = {
    wall: drawSurface,
    floor: drawSurface,
    ceiling: drawSurface,
};

export function installRe2d($) {
    // Теги, у которых нет смысла в 2D: плоскости пола и потолка. Под 2D-камерой
    // <floor> — обычный цветной прямоугольник (план этажа), <ceiling> скрыт.
    TAGS.floor = { body: null, w: 256, h: 256, color: '#ffffff' };
    TAGS.ceiling = { body: null, w: 256, h: 256, color: '#ffffff' };

    registerKindRenderer(KIND_RE2D, (node, cam) => {
        const draw = DRAWERS[node.tag];
        return draw !== undefined ? draw(node, cam) : false;
    });

    registerKindPass(KIND_RE2D, {
        begin(cam) {
            applyRe2dView(cam);
            for (const b of buckets.values()) b.len = 0;
            surfacesDrawn = 0;
        },
        end() {
            // Узлы кадра собраны: отправляем ведра одним вызовом на каждое.
            for (const b of buckets.values()) {
                if (b.len > 0) {
                    engine.re2d.mesh(b.buf, b.len / FLOATS, b.texture, b.cull ? engine.re2d.CULL_BACK : 0);
                }
            }
        },
    });

    /**
     * Комната-коробка: пол, потолок и четыре стены-плиты вокруг внутреннего
     * прямоугольника. Это обычные узлы `<floor>`, `<ceiling>`, `<wall>` вида
     * Re2D — стены со статическим телом, поэтому игрок упирается в них как в
     * любую 2D-стену. Возвращает обёртку всех узлов (класс `re2d-room`).
     *
     *   $.re2d.room({ x: 0, y: 0, w: 1280, h: 1280, height: 280,
     *                 wall: 'art/brick.png', floor: 'art/floor.png', ceiling: 'art/ceil.png' });
     */
    function room(opts) {
        const o = opts || {};
        const x = Number(o.x) || 0, y = Number(o.y) || 0;
        const w = Number(o.w) || 1024, h = Number(o.h) || 1024;
        const top = Number(o.height) > 0 ? Number(o.height) : DEFAULT_HEIGHT;   // высота комнаты
        const t = Number(o.thickness) > 0 ? Number(o.thickness) : 32;
        const tile = Number(o.tile) > 0 ? Number(o.tile) : DEFAULT_TILE;
        const white = '#ffffff';
        const nodes = [];

        const make = (tag, cx, cy, ww, hh, texture, color) => {
            const node = $('<' + tag + '>', { class: 're2d-room', top, tile });
            // Спрайт ДО размера: .sprite() подгоняет узел под размер картинки,
            // если ширина ещё по умолчанию (32) — тонкая плита-стена иначе
            // превратилась бы в квадрат размером с текстуру.
            if (texture) node.sprite(texture);
            node.at(cx, cy).size(ww, hh).color(color).kind(KIND_RE2D).appendTo($.world);
            nodes.push(node.get(0));
        };

        make('floor', x + w / 2, y + h / 2, w, h, o.floor, o.floorColor || white);
        if (o.ceiling !== false) make('ceiling', x + w / 2, y + h / 2, w, h, o.ceiling, o.ceilingColor || white);
        const wc = o.wallColor || white;
        make('wall', x + w / 2, y - t / 2, w + 2 * t, t, o.wall, wc);            // север
        make('wall', x + w / 2, y + h + t / 2, w + 2 * t, t, o.wall, wc);        // юг
        make('wall', x - t / 2, y + h / 2, t, h, o.wall, wc);                    // запад
        make('wall', x + w + t / 2, y + h / 2, t, h, o.wall, wc);                // восток
        return $(nodes);
    }

    $.re2d = {
        room,
        /** Факты о виде: камера (в градусах), счётчики нативного ядра и вёдра кадра. */
        info() {
            return {
                camera: $.camera.info(),
                native: engine.re2d.info(),
                surfaces: surfacesDrawn,
                buckets: [...buckets.values()].filter((b) => b.len > 0)
                    .map((b) => ({ texture: b.texture, cull: b.cull, vertices: b.len / FLOATS })),
            };
        },
    };
}
