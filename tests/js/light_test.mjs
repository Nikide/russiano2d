// ===========================================================================
// Юнит-тесты геометрии света без движка (qjs + tests/js/_harness.mjs).
//
// Свет в стиле Candle держится на четырёх чистых функциях: пересечение луча с
// отрезком, набор углов, расстояния до препятствий и кромка конуса. Если
// врёт хоть одна — тени поедут, поэтому проверяем их отдельно от отрисовки.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/light_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    occluderSegments, tileOccluders, rayDistance, circleAngles, sectorAngles,
    lightBoundary, coneAlpha, fogBands, buildLightIndex, lightIndexPick,
    inheritedVisible, inheritedAlpha, effectiveDepth,
} from '../../src/highlevel/render.js';

// --- Пересечение луча с отрезком -------------------------------------------

test('луч попадает в стенку перед собой', () => {
    near(rayDistance(0, 0, 1, 0, 5, -1, 5, 1), 5);
});

test('стенка за спиной не считается', () => {
    eq(rayDistance(0, 0, 1, 0, -5, -1, -5, 1), Infinity);
});

test('параллельный отрезок не пересекается', () => {
    eq(rayDistance(0, 0, 1, 0, 0, 1, 10, 1), Infinity);
});

test('отрезок мимо луча не считается', () => {
    eq(rayDistance(0, 0, 1, 0, 5, 1, 5, 3), Infinity);
});

test('попадание ровно в конец отрезка засчитывается', () => {
    near(rayDistance(0, 0, 1, 0, 5, 0, 5, 10), 5);
});

test('наклонный луч меряет расстояние по прямой', () => {
    near(rayDistance(0, 0, 0.6, 0.8, 3, 4, 3, 6), 5);
});

// --- Наборы углов -----------------------------------------------------------

test('сектор включает обе границы', () => {
    const a = sectorAngles(0, Math.PI / 2, 5);
    eq(a.length, 5);
    near(a[0], 0);
    near(a[4], Math.PI / 2);
    near(a[2], Math.PI / 4);
});

test('сектор не вырождается при одном образце', () => {
    eq(sectorAngles(0, 1, 1).length, 2);
});

test('круг не дублирует последний угол — веер замыкается сам', () => {
    const a = circleAngles(8);
    eq(a.length, 8);
    near(a[0], -Math.PI);
    truthy(a[7] !== a[0]);
    near(a[7], Math.PI - (Math.PI * 2) / 8);
});

test('число образцов круга ограничено разумным диапазоном', () => {
    eq(circleAngles(2).length, 6);
    eq(circleAngles(9999).length, 256);
});

// --- Граница света ----------------------------------------------------------

test('без препятствий свет доходит до радиуса', () => {
    const d = lightBoundary(0, 0, circleAngles(8), [], 120);
    for (let i = 0; i < d.length; i++) near(d[i], 120);
});

test('стена обрезает свет только в свою сторону', () => {
    const wall = [50, -200, 50, 200];
    const angles = new Float64Array([0, Math.PI]);
    const d = lightBoundary(0, 0, angles, wall, 300);
    near(d[0], 50);          // вправо — стена
    near(d[1], 300);         // влево — свободно
});

test('ближняя стена важнее дальней', () => {
    const segs = [50, -200, 50, 200, 20, -200, 20, 200];
    const d = lightBoundary(0, 0, new Float64Array([0]), segs, 300);
    near(d[0], 20);
});

test('стена дальше радиуса не укорачивает свет', () => {
    const d = lightBoundary(0, 0, new Float64Array([0]), [500, -10, 500, 10], 100);
    near(d[0], 100);
});

test('угол за стеной остаётся тёмным в секторе', () => {
    // Стена стоит справа; конус смотрит вправо — все лучи должны упереться.
    const angles = sectorAngles(-0.3, 0.3, 5);
    const d = lightBoundary(0, 0, angles, [100, -50, 100, 50], 400);
    for (let i = 0; i < d.length; i++) near(d[i], 100 / Math.cos(angles[i]), 1e-6);
});

// --- Кромка конуса ----------------------------------------------------------

test('на границе конуса света нет', () => {
    near(coneAlpha(-0.5, -0.5, 0.5, 0.5), 0);
    near(coneAlpha(0.5, -0.5, 0.5, 0.5), 0);
});

test('в середине конуса свет полный', () => {
    near(coneAlpha(0, -0.5, 0.5, 0.5), 1);
});

test('растушёвка растёт от края к центру', () => {
    const soft = 0.5;                       // перо = 0.25 рад
    near(coneAlpha(-0.5 + 0.125, -0.5, 0.5, soft), 0.5);
    truthy(coneAlpha(-0.5 + 0.2, -0.5, 0.5, soft) > coneAlpha(-0.5 + 0.1, -0.5, 0.5, soft));
});

test('жёсткая кромка: soft=0 даёт ступеньку', () => {
    near(coneAlpha(-0.5 + 1e-6, -0.5, 0.5, 0), 1);
});

// --- Описание препятствий ---------------------------------------------------

test('отрезок списком и объектом дают одно и то же', () => {
    eq(occluderSegments([0, 0, 10, 0]).join(), '0,0,10,0');
    eq(occluderSegments({ x1: 0, y1: 0, x2: 10, y2: 0 }).join(), '0,0,10,0');
});

test('плоский список кратной длины — это набор отрезков, а не один', () => {
    // Так отдаёт tileOccluders: восемь чисел — два отрезка.
    eq(occluderSegments([0, 0, 10, 0, 20, 20, 30, 30]).join(), '0,0,10,0,20,20,30,30');
    eq(occluderSegments(tileOccluders(2, 2, () => true, 10, 0, 0)).length / 4, 8);
});

test('прямоугольник разворачивается в четыре отрезка', () => {
    const segs = occluderSegments({ x: 0, y: 0, w: 10, h: 4 });
    eq(segs.length, 16);
    eq(segs.slice(0, 4).join(), '0,0,10,0');
    eq(segs.slice(4, 8).join(), '10,0,10,4');
});

test('центр и левый верхний угол дают одинаковую коробку', () => {
    eq(occluderSegments({ cx: 5, cy: 2, w: 10, h: 4 }).join(),
       occluderSegments({ x: 0, y: 0, w: 10, h: 4 }).join());
});

test('вложенные списки разворачиваются', () => {
    eq(occluderSegments([[0, 0, 1, 1], [{ x1: 2, y1: 2, x2: 3, y2: 3 }]]).join(), '0,0,1,1,2,2,3,3');
});

test('пустое описание не ломает разбор', () => {
    eq(occluderSegments(null).length, 0);
    eq(occluderSegments([null, undefined, 5]).length, 0);
});

// --- Препятствия из тайлмапа ------------------------------------------------

test('одинокий тайл даёт четыре ребра', () => {
    const cols = 3, rows = 3;
    const solid = (x, y) => x === 1 && y === 1;
    const segs = tileOccluders(cols, rows, solid, 10, 0, 0);
    eq(segs.length / 4, 4);
    eq(segs.slice(0, 4).join(), '10,10,20,10');
});

test('блок 2×2 не даёт внутренних рёбер', () => {
    const solid = () => true;
    const segs = tileOccluders(2, 2, solid, 10, 0, 0);
    eq(segs.length / 4, 8);            // периметр, а не 16
    // Внутреннее ребро между (0,0) и (1,0) — вертикаль x=10 — быть не должно.
    let internal = 0;
    for (let i = 0; i < segs.length; i += 4) {
        if (segs[i] === 10 && segs[i + 2] === 10 && segs[i + 1] === 0 && segs[i + 3] === 10) internal++;
    }
    eq(internal, 0);
});

test('пустая карта не даёт препятствий', () => {
    eq(tileOccluders(4, 4, () => false, 16, 0, 0).length, 0);
});

test('смещение карты учитывается', () => {
    const segs = tileOccluders(1, 1, () => true, 8, 100, 200);
    eq(segs.slice(0, 4).join(), '100,200,108,200');
});

// --- Туман ------------------------------------------------------------------

test('полос тумана столько, сколько заказано', () => {
    const bands = fogBands({ layers: 4, density: 0.4 }, 0, 800, 600);
    eq(bands.length, 4);
    near(bands[0].alpha, 0.1);
});

test('суммарная плотность тумана равна заданной', () => {
    const bands = fogBands({ layers: 5, density: 0.5 }, 0, 800, 600);
    let sum = 0;
    for (const b of bands) sum += b.alpha;
    near(sum, 0.5, 1e-9);
});

test('туман детерминирован и дышит во времени', () => {
    const a = fogBands({ layers: 3, density: 0.3, amp: 0.2 }, 2, 800, 600);
    const b = fogBands({ layers: 3, density: 0.3, amp: 0.2 }, 2, 800, 600);
    const c = fogBands({ layers: 3, density: 0.3, amp: 0.2 }, 3.5, 800, 600);
    eq(a[0].y, b[0].y);
    truthy(Math.abs(a[0].y - c[0].y) > 1e-6);
});

test('приземный туман гуще внизу, чем вверху', () => {
    const bands = fogBands({ layers: 4, density: 0.4, ground: 1 }, 0, 800, 600);
    truthy(bands[3].alpha > bands[0].alpha);
});

test('число полос ограничено сверху', () => {
    eq(fogBands({ layers: 99 }, 0, 800, 600).length, 12);
});

// --- Индекс препятствий по клеткам ------------------------------------------

test('индекс отдаёт только отрезки рядом со светом', () => {
    // Три стенки: у света, далеко и длинная через несколько клеток.
    const segs = [
        0, 0, 20, 0,
        400, 400, 420, 400,
        0, 300, 300, 300,
    ];
    const index = buildLightIndex(segs, 100);
    const near_light = lightIndexPick(index, 10, 10, 50);
    eq(near_light.length, 1);
    eq(near_light[0], 0);
    const far = lightIndexPick(index, 410, 390, 60);
    eq(far.length, 2);
    truthy(far.indexOf(0) < 0);
});

test('длинный отрезок не теряется: он лежит во всех своих клетках', () => {
    const index = buildLightIndex([0, 300, 500, 300], 100);
    eq(lightIndexPick(index, 50, 300, 20).length, 1);
    eq(lightIndexPick(index, 250, 300, 20)[0], 0);
    eq(lightIndexPick(index, 450, 300, 20).length, 1);
});

test('отрезок из нескольких клеток выборки приходит один раз', () => {
    const index = buildLightIndex([0, 50, 300, 50], 100);
    eq(lightIndexPick(index, 150, 50, 250).length, 1);
});

test('далёкий свет не видит ни одного отрезка', () => {
    const index = buildLightIndex([0, 0, 10, 0], 100);
    eq(lightIndexPick(index, 5000, 5000, 50).length, 0);
});

test('пустой реестр даёт пустой индекс', () => {
    const index = buildLightIndex([], 100);
    eq(lightIndexPick(index, 0, 0, 100).length, 0);
});

// --- Отсечение и мягкая кромка ----------------------------------------------

test('count ограничивает набор отрезков для луча', () => {
    const angles = new Float64Array([0]);
    const segs = [100, -10, 100, 10, 50, -10, 50, 10];
    near(lightBoundary(0, 0, angles, segs, 400)[0], 50);
    near(lightBoundary(0, 0, angles, segs, 400, 1)[0], 100);
});

test('мягкая кромка: подлучи обходят узкую стену', () => {
    const angles = circleAngles(8);
    const i = 4;                       // circleAngles начинает с −π, значит 0 — это середина
    near(angles[i], 0);
    // Стенка ровно перед лучом и уже, чем разброс подлучей.
    const segs = [100, -0.05, 100, 0.05];
    const crisp = lightBoundary(0, 0, angles, segs, 400, 1, 1);
    const soft = lightBoundary(0, 0, angles, segs, 400, 1, 4);
    near(crisp[i], 100);
    truthy(soft[i] > crisp[i]);
    truthy(soft[i] <= 400);
});

test('мягкая кромка не меняет сплошную стену', () => {
    const angles = circleAngles(8);
    const i = 4;
    const segs = [100, -50, 100, 50];
    const crisp = lightBoundary(0, 0, angles, segs, 400, 1, 1);
    const soft = lightBoundary(0, 0, angles, segs, 400, 1, 4);
    near(crisp[i], 100);
    near(soft[i], crisp[i], 1);
});

test('один луч: мягкость не ломает расчёт', () => {
    const one = new Float64Array([0]);
    near(lightBoundary(0, 0, one, [100, -10, 100, 10], 400, 1, 6)[0], 100);
});

test('spread задаёт ширину полутени', () => {
    const angles = circleAngles(64);
    const i = 32;                                  // ровно 0 рад
    near(angles[i], 0);
    const segs = [100, -0.05, 100, 0.05];          // узкая стенка на пути
    const narrow = lightBoundary(0, 0, angles, segs, 400, 1, 4, 0.0002);
    const wide = lightBoundary(0, 0, angles, segs, 400, 1, 4, 0.05);
    near(narrow[i], 100, 0.1);                     // подлучи ещё попадают
    truthy(wide[i] > 300);                         // широкий разброс уводит мимо
});

// --- Наследование от родителя ---
// Дети в `$` — отдельные узлы, поэтому раньше скрытый контейнер НЕ скрывал
// содержимое, а прозрачность родителя на детей не влияла. Эти функции считают
// эффективные значения по цепочке parent_node.

function node(extra) {
    return Object.assign({ visible: true, alpha: 1, depth: 0, parent_node: null,
                           depth_relative: false }, extra);
}

test('inheritedVisible: родитель скрыт — ребёнок скрыт', () => {
    const parent = node({ visible: false });
    const child = node({ parent_node: parent });
    falsy(inheritedVisible(child), 'скрытый родитель скрывает ребёнка');
    // Скрытый узел невидим и сам: функция отвечает на вопрос «видно ли ЕГО».
    falsy(inheritedVisible(parent), 'скрытый узел невидим сам по себе');
    truthy(inheritedVisible(node({})), 'без родителя видимость своя');
});

test('inheritedVisible: скрыт ВНУК — важен любой предок', () => {
    const grand = node({});
    const parent = node({ parent_node: grand });
    const child = node({ parent_node: parent });
    truthy(inheritedVisible(child));
    grand.visible = false;
    falsy(inheritedVisible(child), 'скрытие деда скрывает внука');
});

test('inheritedAlpha: произведение по цепочке', () => {
    const parent = node({ alpha: 0.5 });
    const child = node({ alpha: 0.5, parent_node: parent });
    near(inheritedAlpha(child), 0.25, 1e-9);
    near(inheritedAlpha(parent), 0.5, 1e-9);
    const none = node({ parent_node: node({ alpha: 0 }) });
    eq(inheritedAlpha(none), 0, 'нулевая прозрачность родителя обнуляет всё');
});

test('effectiveDepth: относительная складывается с родителем', () => {
    const parent = node({ depth: 10 });
    const child = node({ depth: 5, parent_node: parent });
    eq(effectiveDepth(child), 5, 'по умолчанию глубина абсолютная');
    child.depth_relative = true;
    eq(effectiveDepth(child), 15, 'относительная складывается с родителем');
    eq(effectiveDepth(parent), 10, 'родитель остаётся абсолютным');
});

test('effectiveDepth: цепочка относительных складывается', () => {
    const grand = node({ depth: 100, depth_relative: true });
    const parent = node({ depth: 10, depth_relative: true, parent_node: grand });
    const child = node({ depth: 1, depth_relative: true, parent_node: parent });
    eq(effectiveDepth(child), 111, 'все три сложились');
});

test('effectiveDepth: абсолютный родитель — база, дальше не идём', () => {
    const grand = node({ depth: 1000 });                 // абсолютный
    const parent = node({ depth: 10, parent_node: grand });
    const child = node({ depth: 1, depth_relative: true, parent_node: parent });
    // Родитель абсолютен (depth_relative false) → 10 + 1, дед не учитывается.
    eq(effectiveDepth(child), 11);
});

finish();
