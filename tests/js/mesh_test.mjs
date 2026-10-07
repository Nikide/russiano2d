// ===========================================================================
// Юнит-тесты меша со скелетом (src/highlevel/mesh.js) без движка.
//
// Проверяем чистую часть: порядок костей в дереве, сложение углов по
// родителям, покой, разворот на 90°, мягкий сгиб двумя костями, запись цвета
// и UV, а также что деформация пишет ровно в переданный буфер.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/mesh_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { normalizeAngle, createSkeleton, createPart, deformPart, installMesh }
    from '../../src/highlevel/mesh.js';

test('normalizeAngle приводит к (-π, π]', () => {
    near(normalizeAngle(0), 0, 1e-9);
    near(normalizeAngle(Math.PI * 2), 0, 1e-9);
    near(normalizeAngle(Math.PI * 2 + 0.5), 0.5, 1e-9);
    near(normalizeAngle(-0.5), -0.5, 1e-9);
    near(normalizeAngle(3 * Math.PI), Math.PI, 1e-9);
});

test('скелет: порядок костей — родитель раньше ребёнка', () => {
    // Специально перечисляем ребёнка ПЕРВЫМ: порядок должен исправиться.
    const rig = createSkeleton({
        hand: { parent: 'arm', length: 10 },
        arm: { parent: 'root', length: 20 },
        root: { length: 5 },
    });
    // eq сравнивает по ===, поэтому массив приводим к строке.
    eq(rig.bones().join(','), 'root,arm,hand');
});

test('скелет: покой ставит начало кости на конец родителя', () => {
    const rig = createSkeleton({
        root: { x: 100, y: 100, length: 20, angle: 0 },
        arm: { parent: 'root', length: 30, angle: 0 },
    });
    const p = rig.rest();
    near(p.root.x, 100, 1e-9);
    near(p.root.y, 100, 1e-9);
    // Начало arm — конец root: (100 + 20, 100).
    near(p.arm.x, 120, 1e-9);
    near(p.arm.y, 100, 1e-9);
});

test('скелет: углы СКЛАДЫВАЮТСЯ по родителям', () => {
    const rig = createSkeleton({
        root: { x: 0, y: 0, length: 10, angle: Math.PI / 2 },
        arm: { parent: 'root', length: 10, angle: Math.PI / 2 },
    });
    const p = rig.pose({});
    near(p.root.angle, Math.PI / 2, 1e-9);
    near(p.arm.angle, Math.PI, 1e-9);
});

test('скелет: добавочный угол двигает ТОЛЬКО свою кость и детей', () => {
    const rig = createSkeleton({
        root: { x: 0, y: 0, length: 10 },
        arm: { parent: 'root', length: 10 },
        hand: { parent: 'arm', length: 5 },
    });
    const p = rig.pose({ arm: Math.PI / 2 });
    near(p.root.angle, 0, 1e-9);
    near(p.arm.angle, Math.PI / 2, 1e-9);
    // Ребёнок наследует поворот родителя.
    near(p.hand.angle, Math.PI / 2, 1e-9);
});

test('tip возвращает конец кости', () => {
    const rig = createSkeleton({ arm: { x: 10, y: 20, length: 30, angle: 0 } });
    const tip = rig.tip(rig.rest(), 'arm');
    near(tip.x, 40, 1e-9);
    near(tip.y, 20, 1e-9);
});

test('part: часть без костей не «скелетная»', () => {
    const part = createPart({
        verts: [0, 0, 10, 0, 0, 10],
        uv: [0, 0, 1, 0, 0, 1],
        tris: [0, 1, 2],
    });
    eq(part.vertexCount, 3);
    falsy(part.skinned);
});

test('part: bones даёт вес 1 на вершину', () => {
    const part = createPart({
        verts: [0, 0, 10, 0, 0, 10],
        uv: [0, 0, 1, 0, 0, 1],
        tris: [0, 1, 2],
        bones: ['a', 'a', 'b'],
    });
    truthy(part.skinned);
    eq(part.weights[0].length, 1);
    eq(part.weights[0][0][0], 'a');
    near(part.weights[0][0][1], 1, 1e-9);
    eq(part.weights[2][0][0], 'b');
});

test('part: weights берёт до двух костей', () => {
    // ДВЕ вершины: на первую одна кость, на вторую — три (третью отсекаем).
    const part = createPart({
        verts: [0, 0, 1, 1],
        uv: [0, 0, 0, 0],
        tris: [],
        // Формат: плоский список пар «имя, вес» НА ВЕРШИНУ.
        weights: [['a', 0.5, 'b', 0.5], ['a', 1, 'b', 1, 'c', 1]],
    });
    eq(part.weights.length, 2);
    eq(part.weights[0].length, 2);
    eq(part.weights[1].length, 2);
    eq(part.weights[1][0][0], 'a');
    eq(part.weights[1][1][0], 'b');
});

test('deformPart: без костей вершины не двигаются', () => {
    const part = createPart({
        verts: [5, 7], uv: [0.25, 0.75], tris: [],
        colors: [[10, 20, 30]],
    });
    const out = new Float32Array(8);
    const r = deformPart(part, null, null, out);
    eq(r.count, 1);
    near(out[0], 5, 1e-9);
    near(out[1], 7, 1e-9);
    near(out[2], 0.5, 1e-9);      // глубина по умолчанию
    near(out[3], 0.25, 1e-9);     // u
    near(out[4], 0.75, 1e-9);     // v
    near(out[5], 10, 1e-9);
    near(out[6], 20, 1e-9);
    near(out[7], 30, 1e-9);
});

test('deformPart: поворот кости на 90° поворачивает вершину', () => {
    const rig = createSkeleton({ arm: { x: 100, y: 100, length: 10, angle: 0 } });
    const part = createPart({
        verts: [110, 100], uv: [0, 0], tris: [], bones: ['arm'],
    });
    const out = new Float32Array(8);
    // Плечо в покое; руку подняли на 90° → точка справа уходит вниз.
    const r = deformPart(part, rig.pose({ arm: Math.PI / 2 }), rig.rest(), out);
    eq(r.count, 1);
    near(out[0], 100, 1e-4);
    near(out[1], 110, 1e-4);
});

test('deformPart: вес 0.5 делит сдвиг между костями (мягкий сгиб)', () => {
    const rig = createSkeleton({
        root: { x: 0, y: 0, length: 10, angle: 0 },
        arm: { parent: 'root', length: 10, angle: 0 },
    });
    const rest = rig.rest();
    // Вершина на стыке: половина веса на каждую кость.
    const part = createPart({
        verts: [10, 0], uv: [0, 0], tris: [],
        weights: [[['root', 0.5, 'arm', 0.5]]],
    });
    const out = new Float32Array(8);
    // Поворачиваем ТОЛЬКО arm: вершина должна сдвинуться наполовину.
    const pose = rig.pose({ arm: Math.PI });
    deformPart(part, pose, rest, out);
    const full = deformPart(
        createPart({ verts: [10, 0], uv: [0, 0], tris: [], bones: ['arm'] }),
        pose, rest, new Float32Array(8));
    truthy(full.count === 1);
    // Сдвиг с половиной веса строго между покоем и полным сдвигом.
    const zero = deformPart(
        createPart({ verts: [10, 0], uv: [0, 0], tris: [], bones: ['root'] }),
        pose, rest, new Float32Array(8));
    const halfX = out[0], fullX = full.buffer[0], zeroX = zero.buffer[0];
    truthy(Math.min(zeroX, fullX) <= halfX + 1e-6 && halfX <= Math.max(zeroX, fullX) + 1e-6,
           `полувес ${halfX} между ${zeroX} и ${fullX}`);
});

test('deformPart: буфер меньше нужного — count 0, без падения', () => {
    const part = createPart({
        verts: [0, 0, 1, 1], uv: [0, 0, 0, 0], tris: [],
    });
    const r = deformPart(part, null, null, new Float32Array(8));
    eq(r.count, 0);
    eq(r.need, 16);
});

test('deformPart: пишет РОВНО в переданный буфер (без аллокаций)', () => {
    const part = createPart({ verts: [1, 2], uv: [0, 0], tris: [] });
    const buf = new Float32Array(8);
    const r = deformPart(part, null, null, buf);
    truthy(r.buffer === buf, 'вернулся тот же буфер');
    near(buf[0], 1, 1e-9);
});

// --- часть из слайса Aseprite ---
// Aseprite хранит в слайсе прямоугольник И ПИВОТ. Пивот должен стать началом
// координат части: иначе часть крутится вокруг угла картинки, а не вокруг
// сустава — это и проверяем.
test('fromSlice: пивот становится началом координат', () => {
    const mesh = installMesh({});
    const sheet = {
        texture: 7,
        frames: () => ['a 0.aseprite', 'a 1.aseprite'],
        info: (n) => (n === 'a 0.aseprite'
            ? { name: n, x: 0, y: 0, w: 16, h: 16 }
            : { name: n, x: 16, y: 0, w: 16, h: 16 }),
        size: () => [32, 16],
        slice: (name) => (name === 'hand'
            ? { frame: 0, x: 0, y: 0, w: 16, h: 16,
                pivotX: 4, pivotY: 12, pivotLx: 4, pivotLy: 12 }
            : null),
    };
    const part = mesh.fromSlice(sheet, 'hand', 0, { bone: 'arm' });
    truthy(part !== null, 'часть создана');
    eq(part.vertexCount, 4);
    // Пивот (4,12) → левый верхний угол части в (-4,-12).
    eq(JSON.stringify(part.verts), JSON.stringify([-4, -12, 12, -12, 12, 4, -4, 4]));
    // UV из кадра 0 при атласе 32x16.
    eq(JSON.stringify(part.uv.slice(0, 2)), JSON.stringify([0, 0]));
    near(part.uv[2], 0.5, 1e-9);
    eq(part.texture, 7);
    eq(part.weights[0][0][0], 'arm');
    eq(part.slice.name, 'hand');
    near(part.pivot.x, 4, 1e-9);
});

test('fromSlice: второго кадра UV сдвигаются', () => {
    const mesh = installMesh({});
    const sheet = {
        texture: 3,
        frames: () => ['f0', 'f1'],
        info: (n) => (n === 'f0' ? { x: 0, y: 0, w: 8, h: 8 }
                                : { x: 24, y: 8, w: 8, h: 8 }),
        size: () => [32, 16],
        slice: () => ({ frame: 1, x: 0, y: 0, w: 8, h: 8,
                        pivotX: 4, pivotY: 4, pivotLx: 4, pivotLy: 4 }),
    };
    const part = mesh.fromSlice(sheet, 'any', 1);
    near(part.uv[0], 24 / 32, 1e-9);
    near(part.uv[1], 8 / 16, 1e-9);
    // Без bone костей нет — часть просто рисуется на месте.
    falsy(part.skinned);
});

test('fromSlice: нет атласа или слайса — null, без падения', () => {
    const mesh = installMesh({});
    eq(mesh.fromSlice(null, 'x'), null);
    eq(mesh.fromSlice({}, 'x'), null);
    eq(mesh.fromSlice({ slice: () => null, frames: () => [], info: () => null,
                        size: () => [1, 1] }, 'x'), null);
});

finish();
