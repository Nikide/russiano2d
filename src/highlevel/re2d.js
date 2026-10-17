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

import { engine } from './native.js';
import { prepareRotWorldPose, registerRotWorldNode } from './rotsprite.js';
import { TAGS, withAlpha } from './core.js';
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

// --- Билборды ------------------------------------------------------------------
//
// Персонаж, предмет, обычный спрайт в Re2D — плоская картинка, стоящая на полу и
// всегда повёрнутая к камере (как в Doom). Позиция узла (x, y) — точка на полу,
// основание — `.depth` (высота над полом), `.size(w, h)` — размер картинки в
// единицах мира. Узлы не рисуются по одному: отрисовщик только записывает
// «запись» билборда, а в конце прохода одним нативным вызовом проецируются все
// основания, записи сортируются от дальних к ближним и уходят в общий батч.
// Спрайты рисуются поверх меша (ограничение z-буфера), поэтому внутри комнаты
// перекрытия стенами не бывает; между собой билборды сортируются по глубине.

/** Шаг квантования позы Re2DSprite, градусы: чаще поза не пересчитывается. */
let poseStep = 3;

/**
 * Предел синтезов позы за кадр. Синтез картинки персонажа в C стоит заметно
 * (pixel-стиль около 1 мс, anime около 11 мс), а обход камеры сдвигает позы
 * всех персонажей разом: без предела один кадр мог бы получить десяток синтезов.
 * Не уместившиеся поправки откладываются на следующий кадр (персонаж на кадр-два
 * отстаёт от камеры); 0 — без предела.
 */
let poseBudget = 4;
let posesThisFrame = 0, posesUpdated = 0, posesDeferred = 0;

const records = [];       // переиспользуемые записи кадра (без аллокаций после прогрева)
let recordCount = 0;
let billboardsDrawn = 0;
let points = new Float32Array(3 * 64);
let projected = new Float32Array(4 * 64);
let frameView = { focal: 1, fogFar: 0, fogMin: 0.25, w: 800, h: 600 };

/**
 * Поза Re2DSprite для наблюдателя: yaw — на сколько персонаж повёрнут относительно
 * камеры (0 — лицом к зрителю, +90 — лицом вправо от зрителя), pitch — угол, под
 * которым зритель видит центр персонажа (положительный — снизу вверх, поэтому
 * когда глаза выше центра, он отрицательный). Углы в градусах; `facing` — куда
 * смотрит персонаж на полу, радианы (0 — вдоль +x, как `node.angle`).
 */
export function billboardPose(camX, camY, eye, nx, ny, centerZ, facing) {
    const dx = nx - camX, dy = ny - camY;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const fx = dx / dist, fy = dy / dist;                 // взгляд камеры на персонажа
    const rx = -fy, ry = fx;                              // вправо от взгляда
    const ax = Math.cos(facing), ay = Math.sin(facing);   // куда смотрит персонаж
    const yaw = Math.atan2(ax * rx + ay * ry, -(ax * fx + ay * fy)) * 180 / Math.PI;
    const pitch = Math.atan2(centerZ - eye, dist) * 180 / Math.PI;
    return { yaw, pitch };
}

/**
 * Скорость игрока от первого лица: ввод `vec` (x — вправо/влево, y — назад/вперёд,
 * как у `$.input.vec`: W даёт y = -1) поворачивается на yaw камеры. Так `.controls('wasd')`
 * у Re2D-узла под Re2D-камерой ведёт «вперёд» туда, куда смотрят глаза, а A/D
 * сдвигают боком. Возвращает { vx, vy } в единицах мира в секунду.
 */
export function re2dMove(yaw, vec, speed) {
    const forward = -vec.y, strafe = vec.x;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { vx: (forward * c - strafe * s) * speed, vy: (forward * s + strafe * c) * speed };
}

/** Цвет спрайта с затуханием по расстоянию (множитель на rgb, альфа не трогается). */
export function shadeColor(packed, shade) {
    if (shade >= 1) return packed >>> 0;
    const c = packed >>> 0;
    const r = Math.round((c & 255) * shade), g = Math.round(((c >>> 8) & 255) * shade), b = Math.round(((c >>> 16) & 255) * shade);
    return ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}

function billboardSprite(node) {
    if (node.tag === 'rotsprite') {
        const r = node.rot_sprite;
        return r && r.sprite >= 0 ? r.sprite : -1;
    }
    return node.sprite >= 0 ? node.sprite : engine.whiteSprite;
}

// Re2DSprite под углом: поворачиваем модель так, как её видит камера. Поза
// квантуется (`poseStep`): синтез картинки в C дорог, а смена угла на градус глазу
// незаметна; одинаковая квантованная поза нового синтеза не вызывает.
const lastPose = new WeakMap();
function updateRotPose(node, cam, api) {
    const centerZ = (Number(node.depth) || 0) + node.h / 2;
    const pose = billboardPose(cam.x, cam.y, cam.eye, node.x, node.y, centerZ, node.angle);
    const q = (v) => (poseStep > 0 ? Math.round(v / poseStep) * poseStep : v);
    const yaw = q(pose.yaw), pitch = q(pose.pitch);
    const last = lastPose.get(node);
    if (last !== undefined && last.yaw === yaw && last.pitch === pitch) return;
    if (poseBudget > 0 && posesThisFrame >= poseBudget) { posesDeferred++; return; }
    posesThisFrame++;
    posesUpdated++;
    lastPose.set(node, { yaw, pitch });
    api(node).re2dPose(yaw, pitch);
}

let apiRef = null;

/** Записать билборд кадра; нарисует его end() после проекции и сортировки. */
function drawBillboard(node, cam) {
    // Под 2D-камерой узел рисуется обычным 2D-путём.
    if (cam.kind !== KIND_RE2D) return false;
    if (node.tag === 'rotsprite') {
        if (!node.rot_sprite) return true;
        updateRotPose(node, cam, apiRef);
    }
    const sprite = billboardSprite(node);
    if (sprite < 0) return true;

    if (recordCount * 3 + 3 > points.length) {
        const grownPoints = new Float32Array(points.length * 2);
        grownPoints.set(points);
        points = grownPoints;
        projected = new Float32Array(points.length / 3 * 4);
    }
    let rec = records[recordCount];
    if (rec === undefined) rec = records[recordCount] = { sprite: 0, w: 0, h: 0, color: 0, blend: undefined, uid: 0 };
    points[recordCount * 3] = node.x;
    points[recordCount * 3 + 1] = node.y;
    points[recordCount * 3 + 2] = Number(node.depth) || 0;
    rec.sprite = sprite;
    rec.w = node.w * Math.abs(node.scale_x);
    rec.h = node.h * Math.abs(node.scale_y);
    rec.color = withAlpha(node.color, node.alpha);   // альфа узла с учётом родителей — именно сейчас
    rec.blend = node.blend_mode;
    rec.uid = node.uid;
    recordCount++;
    return true;
}

// Проекция всех записей одним вызовом, сортировка дальних → ближних, отправка в батч.
const order = [];
function flushBillboards(cam) {
    billboardsDrawn = 0;
    if (recordCount === 0) return;
    engine.re2d.project(points, projected, recordCount);
    order.length = 0;
    for (let i = 0; i < recordCount; i++) {
        if (projected[i * 4 + 2] >= 0) order.push(i);    // z01 = -1 — позади камеры
    }
    order.sort((a, b) => (projected[b * 4 + 2] - projected[a * 4 + 2]) || (records[a].uid - records[b].uid));
    const push = $ref.gfx.push;
    for (let n = 0; n < order.length; n++) {
        const i = order[n], rec = records[i];
        const x = projected[i * 4], y = projected[i * 4 + 1], k = projected[i * 4 + 3];
        const sw = rec.w * k, sh = rec.h * k;
        if (x + sw / 2 < 0 || x - sw / 2 > cam.w || y < 0 || y - sh > cam.h) continue;
        let color = rec.color;
        if (frameView.fogFar > 0) {
            const depth = frameView.focal / k;
            color = shadeColor(color, Math.max(frameView.fogMin, Math.min(1, 1 - depth / frameView.fogFar)));
        }
        push.sprite(rec.sprite, x, y - sh / 2, sw, sh, 0, color, rec.blend);
        billboardsDrawn++;
    }
    recordCount = 0;
}

let $ref = null;

// Какие теги умеет рисовать вид; остальные под Re2D-камерой пропускаются.
const DRAWERS = {
    wall: drawSurface,
    floor: drawSurface,
    ceiling: drawSurface,
    player: drawBillboard,
    npc: drawBillboard,
    enemy: drawBillboard,
    pickup: drawBillboard,
    bullet: drawBillboard,
    sprite: drawBillboard,
    rect: drawBillboard,
    rotsprite: drawBillboard,
};

/** RE2D World description -> native specialised primitives (no world triangles). */
export function worldPrimitives(description, colorOf) {
    const walls = [], spans = [];
    const rgb = (color) => unpackRgb(colorOf(color || '#ffffff'));
    for (const wall of description.walls || []) {
        walls.push(wall.from[0], wall.from[1], wall.to[0], wall.to[1], wall.bottom, wall.top, ...rgb(wall.color));
    }
    for (const cell of description.cells || []) {
        for (const span of cell.spans || []) {
            spans.push(cell.x, cell.y, cell.w, cell.h, span.bottom, span.top,
                ...rgb(span.floorColor), ...rgb(span.ceilingColor));
        }
    }
    if (![...walls, ...spans].every(Number.isFinite)) throw new TypeError('RE2D World: нужны конечные координаты и высоты');
    return { walls: new Float32Array(walls), spans: new Float32Array(spans) };
}

function worldWrapper($, native) {
    return {
                support(x, y, feet, height, step = 0) { return native.support(x, y, feet, height, step); },
                blocked(x, y, radius, bottom, top) { return native.blocked(x, y, radius, bottom, top); },
                ray(from, to) { return native.ray(from.x, from.y, from.height, to.x, to.y, to.height); },
                info() { return native.info(); },
                lighting(options = {}) {
                    if (options.mode && options.mode !== 'classic') throw new TypeError('Re2D World: supported lighting mode is classic');
                    native.lighting(+!!options.dynamic, +!!options.shadows, +(options.orientationContrast !== false),
                        options.distanceScale ?? 0, options.orientationStrength ?? 0.06, +(options.enabled !== false));
                    return this;
                },
                span(index) {
                    const set = l => native.spanLight(index, l.level,l.r,l.g,l.b,l.fogDensity,l.fogStart,l.fogR,l.fogG,l.fogB);
                    return {
                        heights(bottom,top) { native.spanHeight(index,bottom,top); return this; },
                        info() { return native.spanLight(index); },
                        lighting(options = {}) {
                            const l = native.spanLight(index);
                            if (options.level !== undefined) l.level = options.level;
                            if (options.color !== undefined) [l.r,l.g,l.b] = unpackRgb($.color(options.color)).map(x => x / 255);
                            set(l); return this;
                        },
                        fog(options = {}) {
                            const l = native.spanLight(index);
                            if (options.density !== undefined) l.fogDensity = options.density;
                            if (options.start !== undefined) l.fogStart = options.start;
                            if (options.color !== undefined) [l.fogR,l.fogG,l.fogB] = unpackRgb($.color(options.color)).map(x => x / 255);
                            set(l); return this;
                        },
                    };
                },
                light(options = {}) {
                    const rgb = unpackRgb($.color(options.color ?? '#ffffff')).map(x => x / 255);
                    const token = native.lightCreate(options.x ?? 0,options.y ?? 0,options.h ?? 0,
                        options.radius ?? 100,options.intensity ?? 1,...rgb,+!!options.shadow);
                    const update = patch => {
                        const l = { ...native.lightInfo(token), ...patch };
                        native.lightUpdate(token,l.x,l.y,l.h,l.radius,l.intensity,l.r,l.g,l.b,+l.shadow);
                    };
                    return {
                        info() { return native.lightInfo(token); },
                        at(x,y) { update({x,y}); return this; },
                        height(h) { update({h}); return this; },
                        radius(radius) { update({radius}); return this; },
                        intensity(intensity) { update({intensity}); return this; },
                        shadow(shadow) { update({shadow}); return this; },
                        color(color) { const [r,g,b] = unpackRgb($.color(color)).map(x => x / 255); update({r,g,b}); return this; },
                        life(seconds) { const l=native.lightInfo(token); native.lightVisual(token,seconds,l.flickerMin,l.flickerMax,l.flickerRate,l.flickerSeed); return this; },
                        flicker(options = {}) { const l=native.lightInfo(token); native.lightVisual(token,l.remaining,options.min ?? .5,options.max ?? 1,options.rate ?? 9,options.seed ?? 42); return this; },
                        remove() { native.lightRemove(token); },
                    };
                },
                cellAt(x, y) { return native.cellAt(x, y); },
                spanAt(x, y, h) { return native.spanAt(x, y, h); },
                lightAt(x,y,h) { return native.lightAt(x,y,h); },
                surface(index) {
                    const info = native.surface(index);
                    return info ? { ...info,
                        material(name) { native.surfaceMaterial(index,name); return this; },
                        sky(enabled=true) { native.surfaceSky(index,!!enabled);return this; },
                        // P1 terrain/conveyor gameplay metadata on the surface.
                        terrain(name) { native.surfaceTerrain(index,name); return this; },
                        conveyor(options = {}) {
                            native.surfaceConveyor(index, Number(options.vx ?? 0), Number(options.vy ?? 0),
                                Number(options.accel ?? 600), options.affectsProjectiles ? 1 : 0);
                            return this;
                        },
                        terrainInfo() { return native.surfaceTerrainInfo(index); },
                        conveyorInfo() { return native.surfaceConveyorInfo(index); },
                    } : null;
                },
                terrainAt(x, y, h) { return native.terrainAt(x, y, h); },
                conveyorAt(x, y, h) { return native.conveyorAt(x, y, h); },
                material(name, options) {
                    native.material(name,options.albedo,options.normal ?? '',options.emissive ?? '',
                        options.emissiveStrength ?? 1,options.uScale ?? (1/64),options.vScale ?? (1/64),({masked:0,opaque:1,translucent:2,additive:3})[options.blend ?? "masked"] ?? -1,options.opacity ?? 1,options.mapping === "world",options.filter === "linear");
                    return this;
                },
                portalClosed(index, closed) { native.portalClosed(index, closed); return this; },
                // Portal 2.0: smooth 0..1 state; `portalClosed` remains the binary view.
                portalOpen(index, fraction) { native.portalOpen(index, fraction); return this; },
                portalFraction(index) { return native.portalFraction(index); },
                dispose() { native.dispose(); },
                render(view, entities = [], width = 320, height = 180) {
                    const v = view;
                    engine.re2d.view(v.x, v.y, v.eye, v.yaw * Math.PI / 180,
                        (v.pitch || 0) * Math.PI / 180, (v.fov || 70) * Math.PI / 180);
                    // Existing relative yaw/pitch and attachment/socket synthesis.
                    const nodes = Array.isArray(entities) ? entities.flatMap(e => $(e).toArray()) : $(entities).toArray();
                    const handles = [], transforms = [];
                    const emit = (node, attached = false) => {
                        const r = node.rot_sprite;
                        if (!r) return;
                        if (!attached) {
                            const pose = billboardPose(v.x, v.y, v.eye, node.x, node.y,
                                (Number(node.depth) || 0) + node.h / 2, node.angle);
                            prepareRotWorldPose(node,pose.yaw,pose.pitch);
                        }
                        const children = [...(r.children || [])];
                        for (const child of children) if (child.depth < node.depth) emit(child, true);
                        handles.push(r.handle);
                        transforms.push(node.x, node.y, Number(node.depth) || 0,
                            node.w * Math.abs(node.scale_x), node.h * Math.abs(node.scale_y));
                        for (const child of children) if (child.depth >= node.depth) emit(child, true);
                    };
                    for (const node of nodes) if (!node.rot_sprite?.attachment) emit(node);
                    const sprite = native.frame(width, height, handles, new Float32Array(transforms),
                        v.projection === 'orthographic' ? (v.orthoHeight || 400) : 0);
                    engine.drawSprite(sprite, engine.width / 2, engine.height / 2,
                        engine.width, engine.height, 0, 0xffffffff);
                    return sprite;
                },
            };
}

function rendererWorldWrapper($, native) {
    const world = worldWrapper($, native);
    world.watch = path => {native.watch(path ?? "");return world;};
    world.reloadJSON = text => { native.reloadJSON(text); return world; };
    world.decal = options => {const token=native.decal(options.surface,options.material,options.u ?? 0,options.v ?? 0,options.width ?? 16,options.height ?? 16,options.life ?? 0);return {remove(){native.decalRemove(token);}};};
    world.sky = (options = {}) => {if(options.projection!==undefined&&!['panorama','equirectangular'].includes(options.projection))throw new TypeError('Re2D World: sky projection must be panorama');native.sky(options.texture ?? '',$.color(options.color ?? '#ffffff'),(options.yaw ?? 0)*Math.PI/180,options.exposure ?? 0);return world; };
    world.reload = path => { const text=$.fs.readText(path);if(text==null)throw new Error(`Re2D World: cannot read ${path}`);return world.reloadJSON(text); };
    world.backend = name => { native.backend(name); return world; };
    world.profile = (options = {}) => { native.gpuWait(!!options.gpuWait); return world; };
    world.quality = (options = {}) => { const current=native.info();native.quality(options.poseBudget ?? current.poseBudget,options.poseStep ?? current.poseStep); return world; };
    world.quality({poseBudget:1,poseStep:3});
    const views = ['final','cell-id','span-id','depth','owner','light-level','dynamic-light-count','normal','emissive','bsp','portals','shadow-mask','overdraw'];
    world.debug = {
        view(name) { const mode = views.indexOf(name); if (mode < 0) throw new TypeError(`Re2D World: unsupported debug view ${name}`); native.debugView(mode); return world; },
        renderStats() { return native.info(); },
        visibility() { return native.visibility(); },
    };
    world.audio = {
        source(path,options={}) {
            const state={x:options.x??0,y:options.y??0,h:options.h??48,range:options.range??1200,reference:options.reference??120,volume:options.volume??.7};
            const validate=s=>{if(!Object.values(s).every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1000000)||s.range<=0||s.reference<=0||s.volume<0||s.volume>1)throw new RangeError('Re2D World audio: invalid source parameters');};
            validate(state);
            const channel=$.sound.play(path,{loop:options.loop??true,volume:0,priority:options.priority??20});
            if(channel<0)throw new Error('Re2D World audio: cannot play source');
            let token;
            try{token=native.audioAdd(channel,state.x,state.y,state.h,state.range,state.reference,state.volume,options.hrtf??true);}catch(error){$.sound.stop(channel);throw error;}
            const update=patch=>{const next={...state,...patch};validate(next);native.audioUpdate(token,next.x,next.y,next.h,next.range,next.reference,next.volume);Object.assign(state,next);};
            const source={
                at(x,y,h=state.h){update({x,y,h});return source;},
                volume(v){update({volume:v});return source;},
                range(v){update({range:v});return source;},
                info(){return native.audioInfo(token);},
                stop(){native.audioRemove(token);},
            };return source;
        },
        listener(view){world.camera(view);return world.audio;},
    };
    world.add = target => { $(target).eachNode((i,node) => { registerRotWorldNode(node); native.actorAdd(node); }); return world; };
    // Flat directional atlas sprite: an existing `$` node drawn by the native
    // world compositor (depth, fog, light, direction, pivot). Not a mesh, not an
    // entity: x/y/depth/w/h/angle and `sprite_row` stay ordinary node state.
    world.sprite = (target, options = {}) => {
        const atlas = options.atlas ?? options.texture;
        if (typeof atlas !== 'string' || !atlas) throw new TypeError('world.sprite: atlas PNG path required');
        const cell = options.cell || {};
        const cellW = Math.trunc(options.cellW ?? cell.w ?? 0), cellH = Math.trunc(options.cellH ?? cell.h ?? 0);
        const directions = Math.trunc(options.directions ?? 1);
        const columns = Math.trunc(options.columns ?? directions), rows = Math.trunc(options.rows ?? 1);
        if (!(cellW > 0 && cellH > 0)) throw new RangeError('world.sprite: cell width/height must be positive');
        if (directions < 1 || directions > 16) throw new RangeError('world.sprite: directions 1..16');
        if (columns < 1 || rows < 1) throw new RangeError('world.sprite: columns/rows must be positive');
        const pivots = { center: 0, feet: 1, bottom: 2, 'bottom-center': 2, custom: 3 };
        const pivotName = options.pivot ?? 'feet';
        const pivot = typeof pivotName === 'number' ? pivotName : pivots[pivotName];
        if (pivot === undefined) throw new RangeError('world.sprite: pivot center/feet/bottom-center/custom');
        const pivotDefaultY = pivot === 0 ? .5 : 1;
        const pivotX = Number(options.pivotX ?? .5), pivotY = Number(options.pivotY ?? pivotDefaultY);
        const blends = { masked: 0, opaque: 1, translucent: 2, additive: 3 };
        const blendName = options.blend ?? 'masked';
        const blend = typeof blendName === 'number' ? blendName : blends[blendName];
        if (blend === undefined || blend < 0 || blend > 3) throw new RangeError('world.sprite: blend masked/opaque/translucent/additive');
        $(target).eachNode((i, node) => {
            const width = Number(options.width ?? node.w), height = Number(options.height ?? node.h);
            if (!(width > 0 && height > 0)) throw new RangeError('world.sprite: world width/height must be positive');
            if (!Number.isFinite(pivotX) || !Number.isFinite(pivotY)) throw new RangeError('world.sprite: pivot must be finite');
            node.sprite_row = Math.max(0, Math.trunc(Number(node.sprite_row) || 0));
            native.atlasAdd(node, atlas, columns, rows, directions, options.mirror !== false && directions > 1 ? 1 : 0,
                cellW, cellH, pivot, pivotX, pivotY, width, height, blend,
                Number(options.offsetX ?? 0), Number(options.offsetY ?? 0), Number(options.offsetH ?? 0));
        });
        return world;
    };
    // P2 constrained volumetric sprites: several specialised billboard parts,
    // never a mesh. Box = 4/6 faces at authored offsets; cross = two cards;
    // slice-stack = N bands of the same atlas stacked in height.
    world.volume = (target, options = {}) => {
        const mode = options.mode ?? 'box';
        const width = Number(options.width ?? 96), depth = Number(options.depth ?? 64);
        const height = Number(options.height ?? 150);
        if (!(width > 0 && depth > 0 && height > 0)) throw new RangeError('world.volume: width/depth/height > 0');
        const common = {
            columns: Math.trunc(Number(options.columns ?? 1)), rows: Math.trunc(Number(options.rows ?? 1)),
            directions: Math.trunc(Number(options.directions ?? 1)), mirror: options.mirror === true,
            cell: options.cell || { w: 1, h: 1 }, pivot: options.pivot ?? 'feet',
            blend: options.blend ?? 'masked',
        };
        const parts = [];
        const add = part => {
            if (typeof part.atlas !== 'string' || !part.atlas) throw new TypeError('world.volume: face atlas PNG required');
            native.atlasAdd(part.node, part.atlas, common.columns, common.rows, common.directions,
                common.mirror ? 1 : 0, common.cell.w, common.cell.h, { feet: 1, center: 0, 'bottom-center': 2, custom: 3 }[common.pivot] ?? 1,
                common.pivot === 'center' ? 0.5 : 0.5, common.pivot === 'center' ? 0.5 : 1,
                part.width ?? width, part.height ?? height, { masked: 0, opaque: 1, translucent: 2, additive: 3 }[common.blend] ?? 0,
                part.offsetX ?? 0, part.offsetY ?? 0, part.offsetH ?? 0);
            parts.push(part);
        };
        $(target).eachNode((i, node) => {
            if (mode === 'box') {
                const faces = options.faces || {};
                const d2 = depth / 2, w2 = width / 2, h2 = height / 2;
                if (faces.front) add({ node, atlas: faces.front, offsetY: d2 });
                if (faces.back) add({ node, atlas: faces.back, offsetY: -d2 });
                if (faces.left) add({ node, atlas: faces.left, offsetX: -w2, offsetY: 0 });
                if (faces.right) add({ node, atlas: faces.right, offsetX: w2, offsetY: 0 });
                if (faces.top) add({ node, atlas: faces.top, offsetH: h2, height: width * 0.6 });
                if (faces.bottom) add({ node, atlas: faces.bottom, offsetH: 0, height: width * 0.6 });
            } else if (mode === 'cross') {
                if (!options.atlas) throw new TypeError('world.volume: cross needs atlas');
                add({ node, atlas: options.atlas, offsetX: -width / 6 });
                add({ node, atlas: options.atlas, offsetX: width / 6 });
            } else if (mode === 'slice-stack') {
                if (!options.atlas) throw new TypeError('world.volume: slice-stack needs atlas');
                const slices = Math.max(1, Math.min(32, Math.trunc(Number(options.slices ?? 8))));
                const sliceH = height / slices;
                for (let k = 0; k < slices; k++) {
                    add({ node, atlas: options.atlas, offsetH: k * sliceH, height: sliceH,
                          width: width * (0.7 + 0.3 * Math.sin((k + 1) / (slices + 1) * Math.PI)) });
                }
            } else throw new RangeError('world.volume: mode box|cross|slice-stack');
        });
        return { mode, parts, remove() { $(target).eachNode((i, node) => native.atlasRemove(node)); } };
    };
    // Unified world+actor trace: registered hit proxies are vertical cylinders
    // attached to existing nodes. Not a physics body; the node owns gameplay
    // identity and the registry only references it.
    const hitNodes = [];
    // Callback args are raw nodes in the engine, but accept a wrapper too so the
    // public API is stable for both call styles.
    const rawOf = value => {
        const wrapped = $(value);
        const raw = wrapped && typeof wrapped.get === 'function' ? wrapped.get(0) : undefined;
        return raw ?? value;
    };
    const baseDispose = world.dispose;
    world.dispose = () => { hitNodes.length = 0; baseDispose(); };
    const categoryBits = { enemy: 1, breakable: 2 };
    const maskBits = { world: 1, enemy: 2, breakable: 4 };
    const parseMask = mask => {
        if (mask === undefined) return maskBits.world | maskBits.enemy | maskBits.breakable;
        if (Number.isInteger(mask) && mask >= 0) return mask;
        if (Array.isArray(mask)) {
            let bits = 0;
            for (const name of mask) {
                const bit = maskBits[name];
                if (bit === undefined) throw new RangeError(`world.trace: unknown mask '${name}' (world|enemy|breakable)`);
                bits |= bit;
            }
            return bits;
        }
        throw new TypeError('world.trace: mask must be an array of world/enemy/breakable or integer bits');
    };
    const point = (p, label) => {
        if (!p || typeof p !== 'object') throw new TypeError(`world.trace: ${label} is required`);
        const x = Number(p.x), y = Number(p.y), h = Number(p.h ?? p.height ?? 0);
        if (![x, y, h].every(Number.isFinite)) throw new RangeError(`world.trace: ${label} needs finite x/y/h`);
        return { x, y, h };
    };
    const traceArgs = options => {
        const from = point(options.from, 'from'), to = point(options.to, 'to');
        const mask = parseMask(options.mask);
        const ignoreNode = options.ignore ? rawOf(options.ignore) : null;
        const ignore = ignoreNode ? hitNodes.indexOf(ignoreNode) : -1;
        return { from, to, mask, ignore };
    };
    const decorate = hit => {
        if (!hit) return null;
        return { ...hit, node: hit.type === 2 ? (hitNodes[hit.node] ?? null) : null };
    };
    world.hit = (target, options = {}) => {
        $(target).eachNode((i, node) => {
            const radius = Number(options.radius ?? 24);
            const height = Number(options.height ?? node.h);
            const bottom = Number(options.bottom ?? 0);
            const top = Number(options.top ?? bottom + height);
            const name = options.category ?? 'enemy';
            const category = typeof name === 'number' ? name : categoryBits[name];
            if (category === undefined) throw new RangeError('world.hit: category enemy|breakable');
            if (![radius, bottom, top].every(Number.isFinite) || radius < 0 || top <= bottom)
                throw new RangeError('world.hit: radius >= 0 and top > bottom');
            const raw = rawOf(node);
            native.hitAdd(raw, radius, bottom, top, category);
            hitNodes.push(raw);
            if (typeof $(raw).on === 'function') $(raw).on('remove', () => {
                const index = hitNodes.indexOf(raw);
                if (index >= 0) { hitNodes.splice(index, 1); try { native.hitRemove(raw); } catch (error) { /* world gone */ } }
            });
        });
        return world;
    };
    world.hitRemove = target => {
        $(target).eachNode((i, node) => {
            const raw = rawOf(node);
            native.hitRemove(raw);
            const index = hitNodes.indexOf(raw);
            if (index >= 0) hitNodes.splice(index, 1);
        });
        return world;
    };
    world.trace = (options = {}) => {
        const { from, to, mask, ignore } = traceArgs(options);
        return decorate(native.trace(from.x, from.y, from.h, to.x, to.y, to.h, mask, ignore));
    };
    world.traceAll = (options = {}) => {
        const { from, to, mask, ignore } = traceArgs(options);
        return (native.traceAll(from.x, from.y, from.h, to.x, to.y, to.h, mask, ignore) || []).map(decorate);
    };
    world.remove = target => { $(target).eachNode((i,node) => { const raw=rawOf(node); native.hitRemove(raw); const at = hitNodes.indexOf(raw); if (at >= 0) hitNodes.splice(at, 1); native.atlasRemove(raw); native.actorRemove(raw); }); return world; };
    // P1: authored map metadata and typed spawn points (never a 3D scene).
    // P1 nav: 2D span/portal graph, deterministic A*. Rebuild after topology
    // or actor-size changes; path entries are span indices.
    world.navBuild = options => native.navBuild(
        Number(options.radius ?? 18), Number(options.height ?? 76), Number(options.step ?? 18));
    world.navNearest = (x, y) => native.navNearest(Number(x), Number(y));
    world.navPath = (from, to, capacity = 256, maxVisits = 0) =>
        native.navPath(from, to, capacity, maxVisits);

    // P1 particles: fixed native pool; step runs inside engine.re2d.worldStep.
    // The renderer owns drawing; this wrapper only describes prototypes.
    const particleModes = { screen: 0, billboard: 1, axis: 2, floor: 3 };
    const particleBlends = { masked: 0, translucent: 1, additive: 2 };
    const particlePrototype = (options = {}) => {
        const rgb = unpackRgb($.color(options.color ?? '#ffffff')).map(v => v / 255);
        const modeName = options.mode ?? 'billboard';
        const blendName = options.blend ?? 'translucent';
        const mode = typeof modeName === 'number' ? modeName : particleModes[modeName];
        const blend = typeof blendName === 'number' ? blendName : particleBlends[blendName];
        if (mode === undefined || blend === undefined) throw new RangeError('world.particles: unknown mode/blend');
        const p = new Float32Array(25);
        p[0] = Number(options.x ?? 0); p[1] = Number(options.y ?? 0); p[2] = Number(options.h ?? 0);
        p[3] = Number(options.vx ?? 0); p[4] = Number(options.vy ?? 0); p[5] = Number(options.vh ?? 0);
        p[6] = Number(options.life ?? 1); p[7] = Number(options.size ?? 8);
        p[8] = options.endSize === undefined ? -1 : Number(options.endSize);
        p[9] = Number(options.gravity ?? 0); p[10] = Number(options.drag ?? 0);
        p[11] = rgb[0]; p[12] = rgb[1]; p[13] = rgb[2];
        p[14] = Number(options.alpha ?? 1);
        p[15] = options.endAlpha === undefined ? -1 : Number(options.endAlpha);
        p[16] = Number(options.spread ?? 0); p[17] = Number(options.speed ?? 0);
        p[18] = Number(options.dirX ?? 0); p[19] = Number(options.dirY ?? 0); p[20] = Number(options.dirH ?? 0);
        p[21] = Math.trunc(Number(options.frame ?? 0)); p[22] = Math.trunc(Number(options.frames ?? 0));
        p[23] = blend; p[24] = mode;
        return p;
    };
    world.particles = {
        burst(options = {}) {
            const count = Math.max(0, Math.trunc(Number(options.count ?? 16)));
            return native.particlesBurst(particlePrototype(options), count, Math.trunc(Number(options.seed ?? 0)));
        },
        continuous(options = {}, dt = 1 / 60) {
            return native.particlesContinuous(particlePrototype(options), Number(options.rate ?? 0),
                Number(dt), Math.trunc(Number(options.seed ?? 0)));
        },
        info() { return native.particlesInfo(); },
        budget(count) { native.particlesBudget(Math.trunc(Number(count))); return world; },
        clear() { native.particlesClear(); return world; },
    };

    // P1 VFX bundles: asset-driven bundles over particles/light/decal/sound/
    // screen juice. Engine helper only; gameplay decides when to spawn one.
    const fxBundles = new Map();
    world.fxDefine = (name, bundle) => {
        if (typeof name !== 'string' || !name) throw new TypeError('world.fxDefine: bundle name required');
        if (!bundle || typeof bundle !== 'object') throw new TypeError('world.fxDefine: bundle object required');
        fxBundles.set(name, bundle);
        return world;
    };
    world.fxSpawn = (name, at = {}) => {
        const bundle = fxBundles.get(name);
        if (!bundle) throw new RangeError(`world.fxSpawn: unknown bundle '${name}'`);
        const x = Number(at.x ?? 0), y = Number(at.y ?? 0), h = Number(at.h ?? 0);
        const dirX = Number(at.dx ?? 0), dirY = Number(at.dy ?? 0), dirH = Number(at.dz ?? 0);
        const spawned = { particles: 0, light: false, decal: false, sound: false, shake: 0 };
        for (const preset of bundle.particles || []) {
            const count = Math.max(0, Math.trunc(Number(preset.count ?? 1)));
            if (!count) continue;
            spawned.particles += world.particles.burst({
                ...preset, x, y, h, count,
                dirX: preset.dirX ?? dirX, dirY: preset.dirY ?? dirY, dirH: preset.dirH ?? dirH,
                seed: preset.seed ?? at.seed ?? 0,
            }) || 0;
        }
        if (bundle.light) {
            const l = bundle.light;
            const light = world.light({ x, y, h, radius: l.radius ?? 200, intensity: l.intensity ?? 2,
                color: l.color ?? '#ffffff', shadow: !!l.shadow });
            if (l.life) light.life(Number(l.life));
            spawned.light = true;
        }
        if (bundle.decal) {
            const hit = world.trace({ from: { x, y, h }, to: { x: x + dirX, y: y + dirY, h: h + dirH },
                mask: ['world'] });
            if (hit && hit.type === 1) {
                const d = bundle.decal;
                world.decal({ surface: hit.surface, material: d.material ?? 0,
                    u: d.u ?? 0, v: d.v ?? 0, width: d.width ?? 16, height: d.height ?? 16,
                    life: d.life ?? 0 });
                spawned.decal = true;
            }
        }
        if (bundle.sound && $.sound && typeof $.sound.play === 'function') {
            try { $.sound.play(bundle.sound, { volume: at.volume ?? 1 }); spawned.sound = true; } catch (error) { /* optional */ }
        }
        if (bundle.shake) {
            spawned.shake = Number(bundle.shake);
            const fx = $.vfx || $.fx;
            if (fx && typeof fx.shake === 'function') fx.shake(spawned.shake);
        }
        if (bundle.flash) {
            const fx = $.vfx || $.fx;
            if (fx && typeof fx.flash === 'function') fx.flash(bundle.flash.color ?? '#ffffff', bundle.flash.ms ?? 80);
        }
        return spawned;
    };

    // P2 animated materials: flipbook/scroll/emissive on an existing material.
    world.materialIndex = name => native.materialIndex(name);
    world.materialAnim = (name, options = {}) => {
        const index = native.materialIndex(name);
        if (index == null) throw new RangeError(`world.materialAnim: unknown material '${name}'`);
        native.materialAnimSet(index, Math.trunc(Number(options.frames ?? 1)), Number(options.fps ?? 8),
            options.pingPong ? 1 : 0, Math.trunc(Number(options.seed ?? 0)),
            Number(options.scrollU ?? 0), Number(options.scrollV ?? 0),
            Number(options.pulseHz ?? 0), Number(options.pulseAmount ?? 0));
        return {
            name, index,
            info() { return native.materialAnimInfo(index); },
            remove() { native.materialAnimRemove(index); },
        };
    };

    // P2 postprocess: native descriptor stack + mapping onto the existing final
    // 2D post pass ($.gfx.post). No 3D G-buffer, no shader graph.
    const postEffects = { grade: 0, vignette: 1, flash: 2, tint: 3, pixelate: 4, chroma: 5, bloom: 6 };
    const avg = list => list.reduce((a, b) => a + b, 0) / list.length;
    world.post = {
        set(effect, options = {}) {
            const id = typeof effect === 'number' ? effect : postEffects[effect];
            if (id === undefined) throw new RangeError('world.post.set: grade|vignette|flash|tint|pixelate|chroma|bloom');
            native.postSet(id, Number(options.strength ?? 0), Number(options.r ?? 0), Number(options.g ?? 0),
                Number(options.b ?? 0), Number(options.a ?? 1), Number(options.extra0 ?? 0), Number(options.extra1 ?? 0));
            return this;
        },
        enable(effect, on = true) {
            const id = typeof effect === 'number' ? effect : postEffects[effect];
            if (id === undefined) throw new RangeError('world.post.enable: unknown effect');
            native.postEnable(id, on ? 1 : 0); return this;
        },
        profile(name) { native.postProfile(name); return this; },
        eval() { return native.postEval(); },
        update(dt = 1 / 60) {
            native.postStep(Number(dt));
            const u = native.postEval();
            const scale = u.colorScale || [1, 1, 1], add = u.colorAdd || [0, 0, 0];
            const tint = u.tint || [1, 1, 1, 0];
            const active = u.vignette > 0 || u.chroma > 0 || u.bloom > 0 || u.flash > 0 || Math.abs(avg(scale) - 1) > 1e-4 || u.tint[3] > 0;
            if ($.gfx && typeof $.gfx.post === 'function') $.gfx.post({
                on: active, glow: u.bloom, vignette: u.vignette, chromatic: u.chroma,
                tint_r: tint[0], tint_g: tint[1], tint_b: tint[2], tint_amount: tint[3],
                saturation: avg(scale), brightness: avg(add), blood: u.flash,
            });
            return u;
        },
        reset() { native.postReset(); if ($.gfx && typeof $.gfx.post === 'function') $.gfx.post({ on: false }); return this; },
    };

    // P4 aim assist: nearest registered enemy proxy inside a cone.
    world.aimAssist = (options = {}) => {
        const from = options.from || {};
        const dir = options.dir || {};
        const hit = native.aimAssist(Number(from.x ?? 0), Number(from.y ?? 0), Number(from.h ?? 0),
            Number(dir.x ?? 0), Number(dir.y ?? 0), Number(dir.h ?? 0),
            Number(options.cone ?? 0.2), Number(options.range ?? 1024),
            options.mask === undefined ? 2 : Number(options.mask));
        return hit ? { ...hit, node: hitNodes[hit.node] ?? null } : null;
    };
    // P4 quality presets: gameplay collision/trace never changes, only visual/pose
    // budgets. Values are benchmark-tunable defaults.
    const qualityPresets = {
        low: { poseBudget: 1, poseStep: 6, particles: 300, decals: 64, portalRecursion: 1 },
        medium: { poseBudget: 2, poseStep: 3, particles: 800, decals: 128, portalRecursion: 2 },
        high: { poseBudget: 4, poseStep: 3, particles: 1500, decals: 256, portalRecursion: 3 },
    };
    world.qualityPreset = name => {
        const preset = qualityPresets[name];
        if (!preset) throw new RangeError('world.qualityPreset: low|medium|high');
        native.quality(preset.poseBudget, preset.poseStep);
        native.particlesBudget(preset.particles);
        return { ...preset };
    };
    // P4 controller feel profiles (data only; world.controller consumes them).
    const feelProfiles = {
        classic: { radius: 18, height: 76, eye: 68, step: 18, slopeLimit: 45,
                   gravity: 900, jumpSpeed: 320, maxGround: 230, maxAir: 230,
                   accel: 1800, friction: 1400, airControl: 0.25 },
        fast: { radius: 16, height: 76, eye: 68, step: 20, slopeLimit: 50,
                gravity: 1000, jumpSpeed: 360, maxGround: 320, maxAir: 340,
                accel: 2600, friction: 900, airControl: 0.5 },
        heavy: { radius: 22, height: 84, eye: 76, step: 24, slopeLimit: 40,
                 gravity: 800, jumpSpeed: 280, maxGround: 180, maxAir: 200,
                 accel: 1200, friction: 1800, airControl: 0.1 },
    };
    world.controllerFeel = name => {
        const feel = feelProfiles[name];
        if (!feel) throw new RangeError('world.controllerFeel: classic|fast|heavy');
        return { ...feel };
    };
    world.controllerPreset = (name, extra = {}) => world.controller({ ...world.controllerFeel(name), ...extra });
    // P4 debug data lists for game-side overlays (not renderer hot path).
    world.debug = world.debug || {};
    world.debug.entities = () => ({
        triggers: [...triggerMeta.entries()].map(([token, info]) => ({ token, ...info })),
        movers: [...moverMeta.entries()].map(([token, info]) => ({ token, ...info })),
        secrets: [...secretMeta.entries()].map(([token, info]) => ({ token, ...info })),
        breakables: [...breakableMeta.entries()].map(([token, info]) => ({ token, ...info })),
        hitProxies: [...hitNodes].map(node => ({ id: node.id ?? null, x: node.x, y: node.y, depth: node.depth })),
    });

    // P1 save/load: native snapshot + map identity guard. The game owns the
    // file format wrapper; this API is deterministic and versioned.
    world.saveMapHash = () => native.saveMapHash();
    world.saveState = () => {
        const meta = native.metadata();
        return { format: 're2d-world-save', version: 1,
                 map: { id: meta.id ?? null, version: meta.version ?? null, hash: native.saveMapHash() },
                 state: JSON.parse(native.saveStateJSON()) };
    };
    world.loadState = save => {
        if (!save || save.format !== 're2d-world-save') throw new TypeError('world.loadState: not a re2d-world-save');
        const hash = native.saveMapHash();
        if (save.map && save.map.hash && save.map.hash !== hash)
            throw new RangeError('world.loadState: map hash mismatch (reload rebuilt topology or ids)');
        return native.loadStateJSON(JSON.stringify(save.state));
    };

    // P1 secrets/breakables: authored semantic state + \$.emit events.
    const secretMeta = new Map();
    const breakableMeta = new Map();
    world.secret = (options = {}) => {
        if (typeof options.id !== 'string' || !options.id) throw new TypeError('world.secret: id required');
        const token = native.secretCreate(options.id, Number(options.x ?? 0), Number(options.y ?? 0),
            Number(options.radius ?? 32), Number(options.bottom ?? 0), Number(options.top ?? 64),
            options.once ? 1 : 0);
        secretMeta.set(token, { id: options.id, x: Number(options.x ?? 0), y: Number(options.y ?? 0), radius: Number(options.radius ?? 32), bottom: Number(options.bottom ?? 0), top: Number(options.top ?? 64) });
        return { id: options.id, info() { return native.secretInfo(token); }, remove() { secretMeta.delete(token); native.secretRemove(token); } };
    };
    world.secretsTick = (dt, at = {}) => {
        const fired = [];
        for (const token of native.secretTick(Number(dt), Number(at.x ?? 0), Number(at.y ?? 0), Number(at.feet ?? at.h ?? 0)) || []) {
            const entry = secretMeta.get(token);
            const id = entry && (entry.id ?? entry);
            if (!id) continue;
            fired.push(id);
            $.emit('secret.found', { secret: id });
        }
        return fired;
    };
    world.onSecret = fn => { $.on('secret.found', event => fn(event.data ?? {}, event)); return world; };
    world.breakable = (options = {}) => {
        if (typeof options.id !== 'string' || !options.id) throw new TypeError('world.breakable: id required');
        const token = native.breakableCreate(options.id, Math.trunc(Number(options.hp ?? 100)),
            Math.trunc(Number(options.variant ?? 0)), Math.trunc(Number(options.portal ?? -1)),
            Number(options.x ?? 0), Number(options.y ?? 0), Number(options.radius ?? 24),
            Number(options.bottom ?? 0), Number(options.top ?? 64));
        const meta = { id: options.id, portal: Math.trunc(Number(options.portal ?? -1)), x: Number(options.x ?? 0), y: Number(options.y ?? 0), radius: Number(options.radius ?? 24), bottom: Number(options.bottom ?? 0), top: Number(options.top ?? 64), hp: Math.trunc(Number(options.hp ?? 100)) };
        breakableMeta.set(token, meta);
        return {
            id: options.id,
            hit(damage) {
                const broke = native.breakableDamage(token, Math.trunc(Number(damage)));
                if (broke === 1) $.emit('breakable.broken', { breakable: meta.id, portal: meta.portal });
                return broke === 1;
            },
            info() { return native.breakableInfo(token); },
            remove() { breakableMeta.delete(token); native.breakableRemove(token); },
        };
    };
    world.onBreakable = fn => { $.on('breakable.broken', event => fn(event.data ?? {}, event)); return world; };

    // P1 automap: native XY lines + 2D transform; drawing stays with the game.
    world.automapLines = states => native.automapLines(states);
    world.automapProject = (view, x, y) => native.automapProject(
        Number(view.cx ?? 0), Number(view.cy ?? 0), Number(view.scale ?? 1),
        Number(view.rotation ?? 0), Number(x), Number(y));
    world.metadata = () => native.metadata();
    world.spawns = () => native.spawns();
    world.spawn = id => native.spawn(id);

    // P0-D: authored semantic identity -> runtime handle. Numeric indices stay
    // an implementation detail; reload re-resolves through the baked table.
    world.findCell = name => { const index = native.findCell(name); return index ?? null; };
    world.findWall = name => { const index = native.findWall(name); return index ?? null; };
    world.findSpan = name => { const index = native.findSpan(name); return index ?? null; };
    world.findPortal = name => { const index = native.findPortal(name); return index ?? null; };
    world.findSurface = name => { const index = native.findSurface(name); return index == null ? null : world.surface(index); };

    // P0-C: native player controller. The helper owns math, the game owns the
    // player node/state; not an entity and not a physics body.
    world.controller = (options = {}) => {
        const number = (value, fallback, label) => {
            const v = Number(value ?? fallback);
            if (!Number.isFinite(v)) throw new RangeError(`world.controller: ${label} must be finite`);
            return v;
        };
        const radius = number(options.radius, 18, 'radius');
        const height = number(options.height, 76, 'height');
        const eye = number(options.eye, height - 8, 'eye');
        const step = number(options.step, 18, 'step');
        const slopeLimit = number(options.slopeLimit, 45, 'slopeLimit');
        if (!(radius > 0 && height > 0 && step >= 0 && slopeLimit >= 0 && slopeLimit <= 89))
            throw new RangeError('world.controller: radius/height > 0, step >= 0, slopeLimit 0..89');
        const token = native.controllerCreate(radius, height, eye, step, slopeLimit,
            number(options.gravity, 900, 'gravity'), number(options.jumpSpeed, 320, 'jumpSpeed'),
            number(options.maxGround, 230, 'maxGround'), number(options.maxAir, 230, 'maxAir'),
            number(options.accel, 1800, 'accel'), number(options.friction, 1400, 'friction'),
            number(options.airControl, 0.25, 'airControl'));
        let state = null;
        const place = (x, y, feet = 0) => {
            state = native.controllerInit(token, Number(x) || 0, Number(y) || 0, Number(feet) || 0) ?? null;
            return state;
        };
        return {
            place,
            init: place,
            move(move = {}) {
                if (!state) place(move.x ?? 0, move.y ?? 0, move.feet ?? 0);
                if (!state) return null;
                if (move.x !== undefined) state.x = Number(move.x) || 0;
                if (move.y !== undefined) state.y = Number(move.y) || 0;
                if (move.feet !== undefined) state.feet = Number(move.feet) || 0;
                const dt = Number(move.dt ?? 1 / 60);
                const wishX = Number(move.dx ?? move.wishX ?? 0);
                const wishY = Number(move.dy ?? move.wishY ?? 0);
                if (![dt, wishX, wishY].every(Number.isFinite) || dt < 0 || dt > 0.5)
                    throw new RangeError('world.controller.move: finite dx/dy, dt 0..0.5');
                state = native.controllerMove(token, state.x, state.y, state.feet,
                    Number(state.vx) || 0, Number(state.vy) || 0, Number(state.vz) || 0,
                    wishX, wishY, move.jump ? 1 : 0, dt) ?? state;
                return { ...state };
            },
            state() { return state ? { ...state } : null; },
            remove() { native.controllerRemove(token); },
        };
    };

    // P0-E: native mover timeline. Doors/lifts are authored timelines, not a
    // generic physics body; the runtime applies span heights / portal state.
    const moverTypes = { door: 0, lift: 1, crusher: 2, platform: 3 };
    const moverMeta = new Map();
    world.mover = (options = {}) => {
        const name = options.type ?? 'door';
        const type = typeof name === 'number' ? name : moverTypes[name];
        if (type === undefined) throw new RangeError('world.mover: type door|lift|crusher|platform');
        const span = options.span === undefined ? -1 : Math.trunc(Number(options.span));
        const portal = options.portal === undefined ? -1 : Math.trunc(Number(options.portal));
        if ((span >= 0) === (portal >= 0)) throw new RangeError('world.mover: exactly one of span/portal');
        const from = Number(options.from), to = Number(options.to);
        const speed = Number(options.speed ?? 120), wait = Number(options.wait ?? 0);
        if (![from, to, speed, wait].every(Number.isFinite) || speed <= 0 || wait < 0)
            throw new RangeError('world.mover: finite from/to, speed > 0, wait >= 0');
        const token = native.moverCreate(type, span, portal, from, to, speed, wait,
            options.autoReturn === false ? 0 : 1);
        moverMeta.set(token, { type: name, span, portal, from, to, speed, wait });
        return {
            blocking(flag = true) { native.moverBlock(token, flag ? 1 : 0); return this; },
            open() { native.moverIntent(token, 0); return this; },
            close() { native.moverIntent(token, 1); return this; },
            toggle() { native.moverIntent(token, 2); return this; },
            info() { return native.moverInfo(token); },
            remove() { moverMeta.delete(token); native.moverRemove(token); },
        };
    };
    // P0-F: semantic triggers. Native owns once/cooldown/enter-edge state; the
    // fired semantic ids are re-emitted into the existing $.on/$.emit model.
    const triggerTypes = { enter: 0, use: 1, shoot: 2 };
    const triggerMeta = new Map();
    world.trigger = (options = {}) => {
        const name = options.type ?? 'enter';
        const type = typeof name === 'number' ? name : triggerTypes[name];
        if (type === undefined) throw new RangeError('world.trigger: type enter|use|shoot');
        const id = options.id;
        if (typeof id !== 'string' || !id) throw new TypeError('world.trigger: semantic id required');
        const target = typeof options.target === 'string' ? options.target : '';
        const x = Number(options.x ?? 0), y = Number(options.y ?? 0);
        const radius = Number(options.radius ?? 64), bottom = Number(options.bottom ?? 0);
        const top = Number(options.top ?? bottom + 64), cooldown = Number(options.cooldown ?? 0);
        if (![x, y, radius, bottom, top, cooldown].every(Number.isFinite) || radius <= 0 || top <= bottom || cooldown < 0)
            throw new RangeError('world.trigger: finite volume, radius > 0, top > bottom, cooldown >= 0');
        const token = native.triggerCreate(type, id, target, x, y, radius, bottom, top,
            options.once ? 1 : 0, cooldown);
        const info = { id, target, type, x, y, radius, bottom, top, once: !!options.once, cooldown };
        triggerMeta.set(token, info);
        return { id, target, info() { return info; }, remove() { triggerMeta.delete(token); native.triggerRemove(token); } };
    };
    const emitTriggers = tokens => {
        const fired = [];
        for (const token of tokens || []) {
            const meta = triggerMeta.get(token);
            if (!meta) continue;
            fired.push(meta.id);
            $.emit(meta.id, { world, trigger: meta.id, target: meta.target });
        }
        return fired;
    };
    world.triggerTick = (dt, at = {}) => emitTriggers(
        native.triggerTick(Number(dt), Number(at.x ?? 0), Number(at.y ?? 0), Number(at.feet ?? at.h ?? 0)));
    world.triggerUse = (at = {}) => emitTriggers(
        native.triggerUse(Number(at.x ?? 0), Number(at.y ?? 0), Number(at.h ?? 0)));
    world.triggerShoot = (at = {}) => emitTriggers(
        native.triggerShoot(Number(at.x ?? 0), Number(at.y ?? 0), Number(at.h ?? 0), Number(at.radius ?? 0)));
    // Handler receives the authored trigger payload ({id,target}); the raw $
    // event stays available as the second argument.
    world.onTrigger = (id, fn) => { $.on(id, event => fn(event.data ?? {}, event)); return world; };
    world.camera = (view = {}) => {
        native.camera(view.x ?? 0,view.y ?? 0,view.h ?? view.eye ?? 48,
            (view.yaw ?? 0)*Math.PI/180,(view.pitch ?? 0)*Math.PI/180,(view.fov ?? 70)*Math.PI/180,
            view.near ?? 4,view.projection === 'orthographic' ? (view.orthoHeight ?? 400) : 0);
        return world;
    };
    world.renderToSprite = (view = null,width = 320,height = 180) => {if(view)world.camera(view);return native.frameRegistered(width,height);};
    world.render = (view = null,width = 320,height = 180) => {
        const sprite = world.renderToSprite(view,width,height);
        engine.drawSprite(sprite,engine.width/2,engine.height/2,engine.width,engine.height,0,0xffffffff);
        return sprite;
    };
    return world;
}

export function installRe2d($) {
    $.update(dt => { if (typeof engine.re2d.worldStep === 'function') engine.re2d.worldStep(dt); });
    // P4 capabilities: honest feature matrix, not a silent fallback.
    const hrtf = $.audio && typeof $.audio.hrtf === 'function' ? $.audio.hrtf() : null;
    $.capabilities = $.capabilities || {};
    $.capabilities.re2d = Object.freeze({
        worldGpu: true, worldCpu: true,
        hrtf: !!(hrtf && hrtf.on),
        mirrorPortal: false, skyPortal: false, volumetricSprite: true,
        particles: true, nav: true, automap: true, saveState: true,
        maxLights: 128, maxDecals: 128, maxWorldSprites: 4096,
        maxPortalRecursion: 4, maxParticles: 2048,
    });

    $.re2dWorld = {
        load(path) {
            const text = $.fs.readText(path);
            if (text == null) throw new Error(`Re2D World: cannot read ${path}`);
            const world=rendererWorldWrapper($, engine.re2d.worldLoad(text));if(engine.hotReload())world.watch(path);return world;
        },
        fromJSON(text) {
            return rendererWorldWrapper($, engine.re2d.worldLoad(text));
        },
    };
    $.re2dWorldAudio = world => {if(!world?.audio)throw new TypeError("Re2D World audio: native world required");return world.audio;};
    $ref = $;
    apiRef = $;
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
            const view = applyRe2dView(cam);
            frameView = {
                focal: (cam.h / 2) / Math.tan(view.fov / 2),
                fogFar: view.fogFar, fogMin: view.fogMin, w: cam.w, h: cam.h,
            };
            for (const b of buckets.values()) b.len = 0;
            surfacesDrawn = 0;
            recordCount = 0;
            posesThisFrame = 0;
            posesUpdated = 0;
            posesDeferred = 0;
        },
        end(cam) {
            // Узлы кадра собраны: ведра мешей — одним вызовом на каждое, затем
            // билборды (их проецируют, сортируют и кладут в общий батч спрайтов).
            for (const b of buckets.values()) {
                if (b.len > 0) {
                    engine.re2d.mesh(b.buf, b.len / FLOATS, b.texture, b.cull ? engine.re2d.CULL_BACK : 0);
                }
            }
            flushBillboards(cam);
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
        /** Spatial description -> synthesised image -> ordinary 2D batch. */
        world(description) {
            const p = worldPrimitives(description || {}, $.color);
            const native = engine.re2d.worldCreate(p.walls, p.spans);
            return worldWrapper($, native);
        },
        /** Предел синтезов позы Re2DSprite за кадр (по умолчанию 4; 0 — без предела). */
        poseBudget(value) {
            if (value === undefined) return poseBudget;
            poseBudget = Math.max(0, Math.floor(Number(value) || 0));
            return $.re2d;
        },
        /** Шаг квантования позы Re2DSprite, градусы (по умолчанию 3; 0 — без квантования). */
        poseStep(value) {
            if (value === undefined) return poseStep;
            poseStep = Math.max(0, Number(value) || 0);
            return $.re2d;
        },
        /** Факты о виде: камера (в градусах), счётчики нативного ядра и вёдра кадра. */
        info() {
            return {
                camera: $.camera.info(),
                native: engine.re2d.info(),
                surfaces: surfacesDrawn,
                billboards: billboardsDrawn,
                poses: { updated: posesUpdated, deferred: posesDeferred },
                buckets: [...buckets.values()].filter((b) => b.len > 0)
                    .map((b) => ({ texture: b.texture, cull: b.cull, vertices: b.len / FLOATS })),
            };
        },
    };
}
