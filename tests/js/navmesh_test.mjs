// ===========================================================================
// Юнит-тесты навигационного меша без движка (qjs).
//
// Проверяют то, что можно проверить без физики: прямоугольную декомпозицию
// свободного пространства, граф порталов, воронку (сглаживание пути) и путь по
// навмешу, включая запас на габарит агента (agentRadius).
//
// ВАЖНО: навмеш — это прямоугольная декомпозиция, а не триангуляция.
// Тесты намеренно опираются на прямоугольники, а не на ожидание треугольников.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/navmesh_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    decomposeRects, buildPortalGraph, funnel, makeMesh, pathOnMesh, effectiveMask,
} from '../../src/highlevel/nav.js';

// --- Вспомогательное --------------------------------------------------------

/** Массив препятствий, заполненный функцией (cx, cy) ⇒ bool. */
function blockedMap(cols, rows, fn) {
    const arr = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) arr[cy * cols + cx] = fn(cx, cy) ? 1 : 0;
    }
    return arr;
}

/** Навмеш cols×rows с клеткой cell в мировых координатах. */
function meshOf(cols, rows, cell, opts) {
    return makeMesh(Object.assign({ x: 0, y: 0, w: cols * cell, h: rows * cell, cell }, opts));
}

/** Суммарная площадь прямоугольников в клетках. */
function rectArea(rects) {
    let sum = 0;
    for (const r of rects) sum += r.w * r.h;
    return sum;
}

/** Проверка: прямоугольники не пересекаются и не задевают стены. */
function assertPartition(rects, blocked, cols, rows) {
    const cover = new Uint8Array(cols * rows);
    for (const r of rects) {
        for (let y = r.cy; y < r.cy + r.h; y++) {
            for (let x = r.cx; x < r.cx + r.w; x++) {
                if (x < 0 || y < 0 || x >= cols || y >= rows) throw new Error(`прямоугольник вне области (${x},${y})`);
                if (blocked[y * cols + x]) throw new Error(`прямоугольник задел стену (${x},${y})`);
                if (cover[y * cols + x]) throw new Error(`прямоугольники пересеклись (${x},${y})`);
                cover[y * cols + x] = 1;
            }
        }
    }
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const free = !blocked[cy * cols + cx];
            if (free !== !!cover[cy * cols + cx]) {
                throw new Error(`покрытие не совпало со свободными клетками в (${cx},${cy})`);
            }
        }
    }
}

// --- 1. Декомпозиция --------------------------------------------------------

test('decomposeRects на пустом поле даёт один прямоугольник', () => {
    const r = decomposeRects(new Uint8Array(5 * 5), 5, 5);
    eq(r.length, 1, 'всё поле — один прямоугольник');
    eq(r[0].cx, 0);
    eq(r[0].cy, 0);
    eq(r[0].w, 5);
    eq(r[0].h, 5);
});

test('decomposeRects полностью закрытое поле даёт пусто', () => {
    const blocked = blockedMap(4, 3, () => true);
    eq(decomposeRects(blocked, 4, 3).length, 0);
});

test('decomposeRects разбивает поле вокруг стены без пересечений и дыр', () => {
    const cols = 6;
    const rows = 4;
    const blocked = blockedMap(cols, rows, (cx, cy) => cx === 2 && cy === 1);
    const rects = decomposeRects(blocked, cols, rows);
    truthy(rects.length >= 2, 'одна стена заставляет дробить поле');
    assertPartition(rects, blocked, cols, rows);
    eq(rectArea(rects), cols * rows - 1, 'площадь равна числу свободных клеток');
});

test('decomposeRects принимает функцию вместо массива', () => {
    const blocked = (cx, cy) => cx >= 2;
    const rects = decomposeRects(blocked, 4, 2);
    eq(rects.length, 1);
    eq(rects[0].w, 2, 'свободны только колонки 0 и 1');
    assertPartition(rects, blockedMap(4, 2, blocked), 4, 2);
});

test('decomposeRects считает выход за границу стеной', () => {
    const rects = decomposeRects(() => false, 3, 3);
    eq(rects.length, 1);
    eq(rects[0].w, 3);
    eq(rects[0].h, 3);
});

// --- 2. Граф порталов -------------------------------------------------------

test('buildPortalGraph связывает два соседних прямоугольника общим ребром', () => {
    const graph = buildPortalGraph([
        { cx: 0, cy: 0, w: 2, h: 2 },
        { cx: 2, cy: 0, w: 2, h: 2 },
    ]);
    eq(graph.portals.length, 1, 'одно общее ребро');
    const p = graph.portals[0];
    eq(p.a, 0);
    eq(p.b, 1);
    eq(p.x0, 2, 'портал на границе x=2');
    eq(p.x1, 2);
    eq(p.y0, 0);
    eq(p.y1, 2);
    eq(graph.adjacency[0].length, 1, 'сосед виден с обеих сторон');
    eq(graph.adjacency[1].length, 1);
    eq(graph.adjacency[0][0].index, 1);
    eq(graph.adjacency[1][0].index, 0);
});

test('buildPortalGraph не связывает прямоугольники, касающиеся углом', () => {
    const graph = buildPortalGraph([
        { cx: 0, cy: 0, w: 1, h: 1 },
        { cx: 1, cy: 1, w: 1, h: 1 },
    ]);
    eq(graph.portals.length, 0, 'общая точка — не проход');
    eq(graph.adjacency[0].length, 0);
});

test('buildPortalGraph берёт только общий участок стороны', () => {
    // Второй прямоугольник ниже и уже: общий участок по x = 1..2.
    const graph = buildPortalGraph([
        { cx: 0, cy: 0, w: 3, h: 1 },
        { cx: 1, cy: 1, w: 2, h: 1 },
    ]);
    eq(graph.portals.length, 1);
    const p = graph.portals[0];
    eq(p.y0, 1);
    eq(p.y1, 1);
    eq(p.x0, 1, 'портал начинается там, где начинается нижний прямоугольник');
    eq(p.x1, 3, 'и кончается там, где кончается верхний');
});

test('buildPortalGraph разделяет соседей, если сторона не общая', () => {
    const graph = buildPortalGraph([
        { cx: 0, cy: 0, w: 1, h: 1 },
        { cx: 2, cy: 0, w: 1, h: 1 },
    ]);
    eq(graph.portals.length, 0, 'между ними зазор в клетку');
});

// --- 3. Воронка -------------------------------------------------------------

test('funnel без порталов возвращает исходные точки', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const out = funnel(pts, []);
    eq(out.length, 2);
    eq(out[0].x, 0);
    eq(out[1].x, 10);
});

test('funnel на прямом коридоре оставляет только старт и цель', () => {
    // Старт и цель на одной высоте, портал — вертикальный отрезок x=150.
    const out = funnel([{ x: 0, y: 50 }, { x: 150, y: 50 }, { x: 300, y: 50 }],
        [{ x0: 150, y0: 0, x1: 150, y1: 100 }]);
    eq(out.length, 2, 'прямая не даёт изломов');
    eq(out[0].x, 0);
    eq(out[1].x, 300);
    near(out[1].y, 50);
});

test('funnel на L-коридоре огибает внутренний угол', () => {
    // Горизонтальный коридор y=0..20 переходит в вертикальный x=80..100.
    // Внутренний угол — (80, 20); через него путь короче, чем через (80, 0).
    const out = funnel([{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 90 }],
        [{ x0: 80, y0: 0, x1: 80, y1: 20 }]);
    eq(out.length, 3, 'один излом');
    near(out[0].x, 10);
    near(out[0].y, 10);
    near(out[1].x, 80, 1e-6, 'излом на внутреннем углу');
    near(out[1].y, 20, 1e-6, 'именно на (80,20), а не на (80,0)');
    near(out[2].x, 90);
    near(out[2].y, 90);
});

test('funnel проводит путь через два портала без лишних изломов', () => {
    // Коридор шириной 100, порталы на x=100 и x=200, обе границы y=0..100.
    const out = funnel(
        [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 200, y: 50 }, { x: 300, y: 50 }],
        [
            { x0: 100, y0: 0, x1: 100, y1: 100 },
            { x0: 200, y0: 0, x1: 200, y1: 100 },
        ]
    );
    eq(out.length, 2, 'по прямой коридор не даёт изломов');
});

test('funnel огибает ступеньку из двух порталов', () => {
    // Верхний коридор y=0..20, затем сдвиг вниз y=40..60, потом снова вправо.
    // Ожидаем излом на внутренних углах, а не ломаную через середины порталов.
    const out = funnel(
        [{ x: 0, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 50 }, { x: 200, y: 50 }],
        [
            { x0: 100, y0: 0, x1: 100, y1: 20 },
            { x0: 100, y0: 40, x1: 100, y1: 60 },
        ]
    );
    truthy(out.length >= 3, 'ступенька требует изломов');
    near(out[0].x, 0);
    near(out[out.length - 1].x, 200);
    near(out[out.length - 1].y, 50);
});

// --- 4. Навмеш: построение и аксессоры --------------------------------------

test('makeMesh без размеров возвращает null', () => {
    eq(makeMesh({}), null);
    eq(makeMesh({ w: 100 }), null);
});

test('mesh.rects()/portals() отдают мировые координаты', () => {
    const empty = meshOf(4, 2, 32);
    const er = empty.rects();
    eq(er.length, 1, 'пустое поле — один прямоугольник на всю область');
    eq(er[0].x0, 0);
    eq(er[0].y0, 0);
    eq(er[0].x1, 128);
    eq(er[0].y1, 64);
    eq(empty.portals().length, 0, 'внутри одного прямоугольника порталов нет');

    // Нижний левый угол закрыт — прямоугольников два, между ними портал по y=32.
    const m = meshOf(4, 2, 32);
    m.setBlocked(0, 1, true);
    eq(m.rects().length, 2);
    const portals = m.portals();
    eq(portals.length, 1);
    eq(portals[0].y0, 32, 'граница между прямоугольниками — y=32');
    eq(portals[0].y1, 32);
    eq(portals[0].x0, 32, 'портал начинается там, где начинается нижний прямоугольник');
    eq(portals[0].x1, 128);
});

test('mesh.rectAt/contains указывают на проходимую точку', () => {
    const m = meshOf(4, 2, 32);
    const r = m.rectAt(16, 16);
    truthy(r, 'точка внутри прямоугольника');
    eq(r.index, 0);
    truthy(m.contains(16, 48));
    falsy(m.contains(-10, 16), 'за левой границей — не проходимо');
    falsy(m.contains(16, 200), 'ниже области — не проходимо');
});

test('mesh.setBlocked перестраивает декомпозицию', () => {
    const m = meshOf(4, 4, 32);
    eq(m.rects().length, 1, 'пока всё свободно — один прямоугольник');
    m.setBlocked(1, 1, true);
    const rects = m.rects();
    truthy(rects.length > 1, 'стена дробит декомпозицию');
    falsy(m.contains(48, 48), 'клетка стены не входит в навмеш');
    m.setBlocked(1, 1, false);
    eq(m.rects().length, 1, 'после снятия стены декомпозиция вернулась');
});

test('mesh.buildFromWalls запоминает agentRadius', () => {
    const m = meshOf(6, 4, 32);
    m.buildFromWalls({ tags: ['wall'], agentRadius: 18 });
    eq(m.agentRadius, 18);
    m.inflate(0);
    eq(m.agentRadius, 0);
});

// --- 5. Путь по навмешу -----------------------------------------------------

test('mesh.path на пустом поле идёт прямой', () => {
    const m = meshOf(10, 5, 32);
    const p = m.path({ x: 16, y: 16 }, { x: 16, y: 144 });
    truthy(p && p.length >= 2, 'путь найден');
    eq(p[0].x, 16, 'первая точка — ровно старт');
    eq(p[0].y, 16);
    eq(p[p.length - 1].x, 16, 'последняя точка — ровно цель');
    eq(p[p.length - 1].y, 144);
    eq(p.length, 2, 'воронка убирает середины порталов');
});

test('mesh.path обходит стену-перегородку', () => {
    const cols = 10;
    const rows = 10;
    const m = meshOf(cols, rows, 32);
    // Стена в колонке 5, кроме верхнего ряда — проход только сверху.
    for (let cy = 1; cy < rows; cy++) m.setBlocked(5, cy, true);
    const p = m.path({ x: 80, y: 176 }, { x: 272, y: 176 });
    truthy(p && p.length >= 3, 'путь в обход длиннее прямой');
    eq(p[0].x, 80);
    eq(p[0].y, 176);
    eq(p[p.length - 1].x, 272);
    eq(p[p.length - 1].y, 176);
    // Ни одна точка пути не лежит в стене (точка ровно на внешней границе
    // принадлежит последней клетке, поэтому сдвигаем её внутрь на эпсилон).
    for (const q of p) {
        truthy(q.x >= 0 && q.x <= m.w && q.y >= 0 && q.y <= m.h, `точка (${q.x},${q.y}) внутри области`);
        const c = m.worldToCell(q.x - 1e-6, q.y - 1e-6);
        falsy(m.isBlocked(c.cx, c.cy), `точка (${q.x},${q.y}) не в стене`);
    }
    truthy(p.some((q) => q.y <= 32 + 1e-6), 'путь проходит через верхний проход');
});

test('mesh.path без сглаживания идёт через середины порталов', () => {
    // Верхний правый угол закрыт: свободны колонка 0 целиком и прямоугольник
    // (1..3)×(1..3). Между ними портал x=32, y=32..128.
    const m = meshOf(4, 4, 32);
    m.setBlocked(1, 0, true);
    m.setBlocked(2, 0, true);
    m.setBlocked(3, 0, true);
    const from = { x: 16, y: 16 };
    // Цель намеренно чуть ниже верха портала: прямая from→to пересекает
    // границу портала выше y=32, поэтому воронка обязана вставить угол (32,32).
    const to = { x: 112, y: 40 };
    const raw = m.path(from, to, { smooth: false });
    const smooth = m.path(from, to, { smooth: true });
    truthy(raw && smooth, 'оба пути строятся');
    eq(raw.length, 3, 'ломанная идёт через середину портала');
    near(raw[1].x, 32, 1e-6);
    near(raw[1].y, 80, 1e-6, 'середина портала');
    eq(smooth.length, 3, 'воронка огибает угол портала');
    near(smooth[1].x, 32, 1e-6);
    near(smooth[1].y, 32, 1e-6, 'прижата к верхнему углу портала');
    near(smooth[smooth.length - 1].x, 112);
    near(smooth[smooth.length - 1].y, 40);
});

test('mesh.path недостижимой цели даёт null, allowPartial ведёт к стене', () => {
    const cols = 8;
    const rows = 4;
    const m = meshOf(cols, rows, 32);
    for (let cy = 0; cy < rows; cy++) m.setBlocked(4, cy, true);
    eq(m.path({ x: 16, y: 48 }, { x: 240, y: 48 }), null, 'сплошная стена — пути нет');
    const part = m.path({ x: 16, y: 48 }, { x: 240, y: 48 }, { allowPartial: true });
    truthy(part && part.length >= 2, 'частичный путь есть');
    eq(part[0].x, 16);
    truthy(part[part.length - 1].x < 4 * 32, `путь упирается в стену (x=${part[part.length - 1].x})`);
    for (const q of part) truthy(m.contains(q.x, q.y), 'точка частичного пути внутри навмеша');
});

test('mesh.path притягивает старт из стены к ближайшему прямоугольнику', () => {
    const m = meshOf(4, 4, 32);
    m.setBlocked(1, 1, true);
    // Старт ровно в стене: путь всё равно строится, начинаясь рядом.
    const p = m.path({ x: 48, y: 48 }, { x: 112, y: 112 });
    truthy(p && p.length >= 2, 'путь из стены строится');
    truthy(m.contains(p[0].x, p[0].y), 'первая точка уже вне стены');
});

// --- 6. Запас на габарит агента ---------------------------------------------

test('agentRadius уменьшает свободную площадь декомпозиции', () => {
    const m = meshOf(7, 5, 32);
    for (let cy = 2; cy < 5; cy++) m.setBlocked(3, cy, true);
    const loose = rectArea(m.rects());
    m.inflate(20);
    const tight = rectArea(m.rects());
    truthy(tight < loose, `с запасом на радиус клеток меньше (${tight} < ${loose})`);
});

test('mesh.path с agentRadius не ведёт вплотную к стене', () => {
    const m = meshOf(7, 5, 32);
    for (let cy = 2; cy < 5; cy++) m.setBlocked(3, cy, true);
    m.inflate(20);
    const p = m.path({ x: 16, y: 16 }, { x: 208, y: 16 });
    truthy(p && p.length >= 2, 'путь с габаритом найден');
    // Каждая точка пути лежит в декомпозиции, построенной с запасом: тело
    // агента нигде не задевает стену.
    for (const q of p) truthy(m.contains(q.x, q.y), `точка (${q.x},${q.y}) проходима для тела`);
});

test('pathOnMesh с явным radius считает габарит по вызову', () => {
    const m = meshOf(7, 5, 32);
    for (let cy = 2; cy < 5; cy++) m.setBlocked(3, cy, true);
    const radius = 20;
    const tight = pathOnMesh(m, { x: 16, y: 16 }, { x: 208, y: 16 }, { radius });
    truthy(tight && tight.length >= 2, 'путь с габаритом найден');
    // Каждая точка пути проходима для тела радиуса radius: opts.radius
    // действительно влияет на декомпозицию, а не игнорируется.
    const mask = effectiveMask(m._grid, radius);
    for (const q of tight) {
        const c = m.worldToCell(q.x - 1e-6, q.y - 1e-6);
        falsy(mask[c.cy * m.cols + c.cx] !== 0, `точка (${q.x},${q.y}) проходима для тела`);
    }
    // Без запаса тот же маршрут строится точечно.
    const loose = pathOnMesh(m, { x: 16, y: 16 }, { x: 208, y: 16 }, { radius: 0 });
    truthy(loose && loose.length >= 2, 'точечный путь тоже есть');
});

// --- 7. Кэш и границы -------------------------------------------------------

test('mesh.path кэшируется и сбрасывается при смене препятствий', () => {
    const m = meshOf(6, 6, 32);
    const a = m.path({ x: 16, y: 16 }, { x: 176, y: 176 });
    const b = m.path({ x: 16, y: 16 }, { x: 176, y: 176 });
    truthy(a === b, 'повторный вызов отдаёт тот же массив из кэша');
    m.setBlocked(3, 3, true);
    const c = m.path({ x: 16, y: 16 }, { x: 176, y: 176 });
    truthy(c !== a, 'после изменения препятствий путь пересчитан');
    truthy(c && c.length >= 2);
});

test('mesh.clear снимает препятствия', () => {
    const m = meshOf(4, 4, 32);
    m.setBlocked(1, 1, true);
    truthy(m.rects().length > 1);
    m.clear();
    eq(m.rects().length, 1, 'поле снова пустое');
    truthy(m.contains(48, 48), 'клетка снова проходима');
});

test('mesh.path не путается с сеткой (isGridLike)', () => {
    const m = meshOf(5, 5, 32);
    // У навмеша есть blocked/cols/rows, но $.nav.path должен видеть в нём
    // именно навмеш: pathOnMesh работает, а сеточный pathOnGrid — нет.
    truthy(m.path({ x: 16, y: 16 }, { x: 144, y: 144 }));
    truthy(typeof m.path === 'function');
    eq(m.cols, 5);
    eq(m.rows, 5);
});

finish();
