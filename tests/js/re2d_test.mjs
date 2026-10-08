// ===========================================================================
// Юнит-тесты геометрии и отрисовщика Re2D (src/highlevel/re2d.js) — фаза 4
// docs/RE2D.md: плоскости, стены-призмы, комната-коробка, вёдра кадра.
//
// Нативное ядро подменяет заглушка, поэтому проверяется JS-слой: нарезка на
// ячейки, границы и UV, ОБХОД граней (тот самый инвариант «снаружи грань
// лицевая»: он связывает геометрию с камерой и проверяется независимой
// формулой проекции прямо в тесте), кэш геометрии и отправка вёдер.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/re2d_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { cameraTransform } from '../../src/highlevel/camera.js';
import { kindPass, kindRenderer } from '../../src/highlevel/kinds.js';
import {
    cellsFor, unpackRgb, pushPlane, pushWall, pushPrism, planeFloats, prismFloats,
    DEFAULT_HEIGHT, DEFAULT_TILE,
} from '../../src/highlevel/re2d.js';

const $ = createApi();
const UV = { u0: 0, v0: 0, u1: 1, v1: 1 };
const WHITE = [255, 255, 255];

// Заглушка нативного ядра: запоминает отправленные меши.
const meshes = [];
engine.re2d = {
    view: () => true,
    project: () => 0,
    unproject: () => null,
    info: () => ({ stats: {} }),
    sprite: (id) => (id === 77 ? { texture: 5, u0: 0.25, v0: 0.5, u1: 0.75, v1: 1, w: 32, h: 32 } : null),
    mesh: (buf, count, texture, flags) => { meshes.push({ buf: buf.slice(0, count * 8), count, texture, flags }); return count; },
    CULL_BACK: 1,
};

// Проекция по независимой формуле (те же соглашения, что в src/re2d_math.h).
function project(view, p) {
    const dx = p[0] - view.x, dy = p[1] - view.y, up = p[2] - view.eye;
    const fwd = dx * Math.cos(view.yaw) + dy * Math.sin(view.yaw);
    const right = -dx * Math.sin(view.yaw) + dy * Math.cos(view.yaw);
    const depth = fwd * Math.cos(view.pitch) + up * Math.sin(view.pitch);
    const upv = up * Math.cos(view.pitch) - fwd * Math.sin(view.pitch);
    if (depth < 4) return null;
    const f = 300 / Math.tan(view.fov / 2);
    return [400 + right * f / depth, 300 - upv * f / depth];
}

// Площадь треугольника на экране: > 0 — обход по часовой стрелке (лицевая грань).
function screenArea(view, verts, o) {
    const a = project(view, [verts[o], verts[o + 1], verts[o + 2]]);
    const b = project(view, [verts[o + 8], verts[o + 9], verts[o + 10]]);
    const c = project(view, [verts[o + 16], verts[o + 17], verts[o + 18]]);
    if (!a || !b || !c) return null;
    return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
}

function reset() {
    $('*').remove();
    meshes.length = 0;
    $.camera.kind(null).yaw(0).pitch(0).eye(48).fov(90).fog(0).at(0, 0).unfollow().zoom(1);
}

test('cellsFor: от 1 до предела, тайл по умолчанию', () => {
    eq(cellsFor(10, 64), 1, 'короче тайла — одна ячейка');
    eq(cellsFor(64, 64), 1, 'ровно тайл');
    eq(cellsFor(65, 64), 2, 'чуть длиннее — две');
    eq(cellsFor(-128, 64), 2, 'знак длины не важен');
    eq(cellsFor(1e9, 64), 96, 'предел защищает от миллиона треугольников');
    eq(cellsFor(128, 0), 128 / DEFAULT_TILE, 'тайл 0 — берётся по умолчанию');
});

test('unpackRgb разбирает упакованный цвет узла', () => {
    const [r, g, b] = unpackRgb($.color('#336699'));
    eq([r, g, b].join(','), '51,102,153', 'rgb');
});

test('pushPlane: ячейки по тайлу, границы, высота, UV и цвет', () => {
    const verts = new Float32Array(planeFloats(128, 64, 64));
    const end = pushPlane(verts, 0, 0, 0, 128, 64, 10, 64, { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.8 }, [10, 20, 30]);
    eq(end, verts.length, 'записано ровно столько, сколько посчитано');
    eq(end / 8, 12, '2 ячейки × 2 треугольника × 3 вершины');
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < end; i += 8) {
        minX = Math.min(minX, verts[i]); maxX = Math.max(maxX, verts[i]);
        minY = Math.min(minY, verts[i + 1]); maxY = Math.max(maxY, verts[i + 1]);
        eq(verts[i + 2], 10, 'плоскость на высоте 10');
        truthy(verts[i + 3] >= 0.1 - 1e-6 && verts[i + 3] <= 0.9 + 1e-6, 'u внутри прямоугольника текстуры');
        truthy(verts[i + 4] >= 0.2 - 1e-6 && verts[i + 4] <= 0.8 + 1e-6, 'v внутри прямоугольника текстуры');
        eq(verts[i + 5] + ',' + verts[i + 6] + ',' + verts[i + 7], '10,20,30', 'цвет вершины');
    }
    eq(minX + ',' + maxX + ',' + minY + ',' + maxY, '0,128,0,64', 'границы плоскости');
});

test('pushWall: концы грани, диапазон высот, число ячеек', () => {
    const n = cellsFor(200, 64) * cellsFor(100, 64);
    const verts = new Float32Array(n * 48);
    const end = pushWall(verts, 0, 0, 0, 200, 0, 5, 105, 64, UV, WHITE);
    eq(end, verts.length, 'записано ровно посчитанное');
    let minZ = 1e9, maxZ = -1e9, maxX = -1e9;
    for (let i = 0; i < end; i += 8) {
        minZ = Math.min(minZ, verts[i + 2]); maxZ = Math.max(maxZ, verts[i + 2]);
        maxX = Math.max(maxX, verts[i]);
        eq(verts[i + 1], 0, 'грань идёт вдоль x');
    }
    eq(minZ + ',' + maxZ + ',' + maxX, '5,105,200', 'диапазон высот и длина');
});

test('pushPrism: размер буфера совпадает с prismFloats', () => {
    const size = prismFloats(100, 60, 120, 64);
    const verts = new Float32Array(size);
    eq(pushPrism(verts, 0, 0, 0, 100, 60, 0, 120, 64, UV, WHITE), size, 'четыре грани');
});

test('обход граней: снаружи лицевая ровно та, что смотрит на зрителя', () => {
    // Коробка 200×200×100 с центром в (0, 0). Зритель стоит снаружи с каждой
    // стороны и смотрит на центр: лицевой (площадь > 0) должна быть одна грань.
    const verts = new Float32Array(prismFloats(200, 200, 100, 400));
    pushPrism(verts, 0, -100, -100, 100, 100, 0, 100, 400, UV, WHITE);   // по одной ячейке на грань
    const faceFirst = [0, 48, 96, 144];                                  // начало каждой грани, float
    const names = ['восток', 'запад', 'юг', 'север'];
    const viewers = [
        { name: 'восток', x: 400, y: 0, yaw: Math.PI },
        { name: 'запад', x: -400, y: 0, yaw: 0 },
        { name: 'юг', x: 0, y: 400, yaw: -Math.PI / 2 },
        { name: 'север', x: 0, y: -400, yaw: Math.PI / 2 },
    ];
    for (const v of viewers) {
        const view = { x: v.x, y: v.y, eye: 50, yaw: v.yaw, pitch: 0, fov: Math.PI / 2 };
        for (let f = 0; f < 4; f++) {
            const area = screenArea(view, verts, faceFirst[f] * 8 / 8 + 0);
            const facing = names[f] === v.name;
            if (facing) truthy(area !== null && area > 0, `зритель с ${v.name}: грань «${names[f]}» лицевая (${area})`);
            else if (area !== null) truthy(area < 0, `зритель с ${v.name}: грань «${names[f]}» не лицевая (${area})`);
        }
    }
});

test('изнутри комнаты видны внутренние грани плит', () => {
    // Плита-стена на севере комнаты: зритель внутри, смотрит на север (yaw = -π/2).
    const verts = new Float32Array(prismFloats(400, 32, 100, 800));
    pushPrism(verts, 0, -200, -216, 200, -184, 0, 100, 800, UV, WHITE);
    const view = { x: 0, y: 0, eye: 50, yaw: -Math.PI / 2, pitch: 0, fov: Math.PI / 2 };
    // Грани идут порядком: восток, запад, юг (внутренняя, обращена к зрителю), север (внешняя).
    // Каждая грань нарезана на одну ячейку (800 > длины), у ячейки 6 вершин.
    const southFace = 2 * 48;
    const northFace = 3 * 48;
    truthy(screenArea(view, verts, southFace) > 0, 'внутренняя (южная) грань плиты лицевая');
    const outer = screenArea(view, verts, northFace);
    truthy(outer === null || outer < 0, 'внешняя (северная) грань не лицевая');
});

test('$.re2d.room: шесть узлов вида Re2D, стены со статическим телом', () => {
    reset();
    const room = $.re2d.room({ x: 100, y: 200, w: 800, h: 600, height: 300 });
    eq(room.length, 6, 'пол, потолок и четыре стены');
    eq($('.re2d-room').length, 6, 'общий класс');
    eq($('wall.re2d-room').length, 4, 'четыре стены');
    eq($('floor').length, 1, 'пол'); eq($('ceiling').length, 1, 'потолок');
    eq($('[kind=re2d]').length, 6, 'все — вида re2d');
    const floor = $('floor').get(0);
    eq(floor.x + ',' + floor.y + ',' + floor.w + ',' + floor.h, '500,500,800,600', 'пол покрывает внутренний прямоугольник');
    eq($('ceiling').attr('top'), 300, 'высота комнаты ушла в атрибут top');
    const south = $('wall').toArray().map((w) => w.y).sort((a, b) => a - b);
    near(south[0], 200 - 16, 1e-9, 'северная плита снаружи внутреннего прямоугольника');
    near(south[south.length - 1], 800 + 16, 1e-9, 'южная — тоже');
    truthy($('wall').get(0).body_kind === 'static', 'стена с телом static: игрок упрётся');
    const noCeil = $.re2d.room({ x: 0, y: 0, w: 100, h: 100, ceiling: false });
    eq(noCeil.length, 5, 'ceiling: false — без потолка');
});

test('отрисовщик: стена в ведре с CULL_BACK, пол без него, одно обращение на ведро', () => {
    reset();
    $.camera.kind(Re2D).at(0, 0);
    $('<wall>', { id: 'w', top: 100 }).at(300, 0).size(40, 100).kind(Re2D);
    $('<floor>', { id: 'f' }).at(0, 0).size(200, 200).kind(Re2D);
    const cam = cameraTransform();
    kindPass('re2d').begin(cam);
    const draw = kindRenderer('re2d');
    eq(draw($('#w').get(0), cam), true, 'стена нарисована');
    eq(draw($('#f').get(0), cam), true, 'пол нарисован');
    eq(draw($('<npc>').kind(Re2D).get(0), cam), false, 'билборды — следующая фаза: тег не берётся');
    kindPass('re2d').end(cam);
    eq(meshes.length, 2, 'два ведра: стены и плоскости');
    const wall = meshes.find((m) => m.flags === 1);
    const plane = meshes.find((m) => m.flags === 0);
    truthy(wall && plane, 'стена с флагом CULL_BACK, пол без');
    eq(wall.count, prismFloats(40, 100, 100, DEFAULT_TILE * 4) / 8, 'вершин стены = посчитанное');
    eq(wall.texture, -1, 'без спрайта — белая текстура');
    eq(plane.count, planeFloats(200, 200, DEFAULT_TILE * 4) / 8, 'вершин пола = посчитанное');
});

test('геометрия кэшируется и пересобирается при смене полей узла', () => {
    reset();
    $.camera.kind(Re2D);
    const f = $('<floor>', { id: 'f' }).at(0, 0).size(64, 64).kind(Re2D);
    const cam = cameraTransform();
    const draw = kindRenderer('re2d');
    const frame = () => { meshes.length = 0; kindPass('re2d').begin(cam); draw(f.get(0), cam); kindPass('re2d').end(cam); return meshes[0].count; };
    const small = frame();
    eq(frame(), small, 'тот же кадр — те же вершины');
    f.size(512, 512);
    truthy(frame() > small, 'после .size() вершин больше: геометрия перестроена');
    f.size(64, 64);
    eq(frame(), small, 'вернули размер — вернулось число вершин');
});

test('спрайт узла даёт текстуру и её прямоугольник для UV', () => {
    reset();
    $.camera.kind(Re2D);
    const wall = $('<wall>', { id: 'tw', tile: 64, top: 64 }).at(0, 0).size(64, 64).color('#ffffff').kind(Re2D);
    wall.get(0).sprite = 77;                    // как после .sprite('путь') — id из реестра движка
    const cam = cameraTransform();
    kindPass('re2d').begin(cam);
    kindRenderer('re2d')(wall.get(0), cam);
    kindPass('re2d').end(cam);
    const m = meshes[meshes.length - 1];
    eq(m.texture, 5, 'текстура берётся у спрайта');
    let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
    for (let i = 0; i < m.count; i++) {
        uMin = Math.min(uMin, m.buf[i * 8 + 3]); uMax = Math.max(uMax, m.buf[i * 8 + 3]);
        vMin = Math.min(vMin, m.buf[i * 8 + 4]); vMax = Math.max(vMax, m.buf[i * 8 + 4]);
    }
    eq(uMin + ',' + uMax + ',' + vMin + ',' + vMax, '0.25,0.75,0.5,1', 'UV внутри прямоугольника спрайта');
});

test('под 2D-камерой: пол и стены деградируют в 2D, потолок скрыт', () => {
    reset();
    const cam = cameraTransform();        // камера 2D
    const draw = kindRenderer('re2d');
    const wall = $('<wall>').kind(Re2D).get(0);
    const floor = $('<floor>').kind(Re2D).get(0);
    const ceil = $('<ceiling>').kind(Re2D).get(0);
    eq(draw(wall, cam), false, 'стена: 2D-путь (план этажа)');
    eq(draw(floor, cam), false, 'пол: 2D-путь');
    eq(draw(ceil, cam), true, 'потолок: «нарисован» — то есть скрыт, 2D-путь не нужен');
    eq(meshes.length, 0, 'в нативный меш ничего не ушло');
});

test('$.re2d.info отдаёт вёдра кадра структурой', () => {
    reset();
    $.camera.kind(Re2D);
    $('<floor>').at(0, 0).size(64, 64).kind(Re2D);
    const cam = cameraTransform();
    kindPass('re2d').begin(cam);
    kindRenderer('re2d')($('floor').get(0), cam);
    const info = $.re2d.info();
    eq(info.surfaces, 1, 'нарисована одна поверхность');
    eq(info.buckets.length, 1, 'одно ведро');
    eq(info.buckets[0].cull, false, 'пол без отбраковки');
    kindPass('re2d').end(cam);
});

finish();
