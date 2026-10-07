// ===========================================================================
// Юнит-тесты BSP-подсистемы (src/highlevel/bsp.js) без движка.
//
// Проверяем перевод данных: плоский массив ↔ объекты, все принимаемые формы
// отрезков (объект, четвёрка, пара точек), метки и отказ при пустом входе.
// Сам обход дерева живёт в C (tests/bsp/bsp_test.c) — здесь только обёртка.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/bsp_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { segmentsFromFlat, segmentsToFlat } from '../../src/highlevel/bsp.js';

test('segmentsFromFlat: плоский массив в объекты', () => {
    const list = segmentsFromFlat(new Float32Array([0, 0, 10, 0, 5, 5, 5, 20]));
    eq(list.length, 2, 'два отрезка');
    eq(list[0].x1, 0); eq(list[0].y1, 0);
    eq(list[0].x2, 10); eq(list[0].y2, 0);
    eq(list[1].x1, 5); eq(list[1].y2, 20);
    eq(segmentsFromFlat(null).length, 0, 'null — пусто');
    eq(segmentsFromFlat(new Float32Array(0)).length, 0, 'пустой массив');
    // Неполный отрезок отбрасывается: stride 4.
    eq(segmentsFromFlat(new Float32Array([1, 2, 3])).length, 0, 'остаток не берём');
    eq(segmentsFromFlat(new Float32Array([1, 2, 3, 4, 5])).length, 1);
});

test('segmentsToFlat: объекты {x1,y1,x2,y2}', () => {
    const flat = segmentsToFlat([{ x1: 1, y1: 2, x2: 3, y2: 4 }]);
    eq(flat.length, 5, 'stride 5: четыре координаты и метка');
    eq(Array.from(flat).join(','), '1,2,3,4,0', 'метка по умолчанию — индекс');
    const two = segmentsToFlat([{ x1: 0, y1: 0, x2: 1, y2: 1 }, { x1: 2, y1: 2, x2: 3, y2: 3 }]);
    eq(two.length, 10);
    eq(two[9], 1, 'вторая метка — индекс 1');
});

test('segmentsToFlat: форма [x1,y1,x2,y2]', () => {
    const flat = segmentsToFlat([[10, 20, 30, 40]]);
    eq(Array.from(flat).join(','), '10,20,30,40,0');
    truthy(flat instanceof Float32Array, 'на выходе Float32Array');
});

test('segmentsToFlat: форма пары точек', () => {
    // [[x1,y1],[x2,y2]]
    const byArrays = segmentsToFlat([[[1, 2], [3, 4]]]);
    eq(Array.from(byArrays).join(','), '1,2,3,4,0');
    // [{x,y},{x,y}]
    const byPoints = segmentsToFlat([[{ x: 5, y: 6 }, { x: 7, y: 8 }]]);
    eq(Array.from(byPoints).join(','), '5,6,7,8,0');
    // Смешанная форма: первая точка массивом, вторая объектом.
    const mixed = segmentsToFlat([[[1, 1], { x: 2, y: 2 }]]);
    eq(Array.from(mixed).join(','), '1,1,2,2,0');
});

test('segmentsToFlat: метка из отрезка и через tagOf', () => {
    const tagged = segmentsToFlat([{ x1: 0, y1: 0, x2: 1, y2: 1, tag: 7 }]);
    eq(tagged[4], 7, 'метка из отрезка');
    const viaFn = segmentsToFlat([[0, 0, 1, 1], [2, 2, 3, 3]], (s, i) => 100 + i);
    eq(viaFn[4], 100, 'tagOf получает отрезок и индекс');
    eq(viaFn[9], 101);
});

test('segmentsToFlat: мусорные координаты становятся нулём', () => {
    const flat = segmentsToFlat([{ x1: 'чушь', y1: null, x2: undefined, y2: 5 }]);
    eq(Array.from(flat).join(','), '0,0,0,5,0', 'нечисла — ноль, y2 сохраняется');
});

test('segmentsToFlat: пустой вход', () => {
    eq(segmentsToFlat([]).length, 0);
    eq(segmentsToFlat(null).length, 0);
    eq(segmentsToFlat(undefined).length, 0);
    truthy(segmentsToFlat([]) instanceof Float32Array);
});

test('round-trip: объекты → плоско → объекты', () => {
    const source = [
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 80 },
    ];
    const flat = segmentsToFlat(source);
    // segmentsFromFlat читает stride 4, поэтому отрежем метки.
    const stripped = new Float32Array(source.length * 4);
    for (let i = 0; i < source.length; ++i) {
        for (let k = 0; k < 4; ++k) stripped[i * 4 + k] = flat[i * 5 + k];
    }
    const back = segmentsFromFlat(stripped);
    eq(back.length, source.length, 'столько же отрезков');
    eq(back[1].x2, 100);
    eq(back[1].y2, 80);
    near(back[0].x2, source[0].x2, 1e-6);
});

finish();
