// ===========================================================================
// Юнит-тесты кривых и градиентов (src/highlevel/curve.js) без движка.
//
// Проверяем то, что легко сломать: равномерную раскладку точек, зажим на
// концах, ступеньки, плавность сплайна, разбор цветов и градиент по каналам.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/curve_test.mjs
// ===========================================================================

import { test, eq, near, truthy, finish } from './_harness.mjs';
import {
    normalizePoints, sampleLinear, sampleStep, sampleSpline,
    colorToBytes, packColorBytes, makeCurve, makeGradient,
} from '../../src/highlevel/curve.js';

test('normalizePoints: список значений раскладывается равномерно', () => {
    const p = normalizePoints([0, 1, 0.2]);
    eq(p.length, 3);
    near(p[0].x, 0, 1e-9); near(p[0].y, 0, 1e-9);
    near(p[1].x, 0.5, 1e-9); near(p[1].y, 1, 1e-9);
    near(p[2].x, 1, 1e-9); near(p[2].y, 0.2, 1e-9);
});

test('normalizePoints: пары и объекты сохраняют x и сортируются', () => {
    const pairs = normalizePoints([[1, 10], [0, 0], [0.5, 5]]);
    eq(pairs.map((p) => p.x).join(','), '0,0.5,1');
    eq(pairs.map((p) => p.y).join(','), '0,5,10');
    const objs = normalizePoints([{ x: 0.25, y: 3 }, { x: 0, y: 1 }]);
    eq(objs[0].x, 0);
    eq(objs[1].y, 3);
});

test('normalizePoints: пусто и мусор дают одну точку', () => {
    eq(normalizePoints([]).length, 1);
    eq(normalizePoints(null).length, 1);
    eq(normalizePoints([], { value: 5 })[0].y, 5, 'запасное значение');
    eq(normalizePoints([1, 'нет', null]).length, 3, 'мусор в y не роняет разбор');
});

test('sampleLinear: интерполяция и зажим на концах', () => {
    const p = normalizePoints([0, 1, 0]);
    near(sampleLinear(p, 0), 0, 1e-9);
    near(sampleLinear(p, 0.25), 0.5, 1e-9);
    near(sampleLinear(p, 0.5), 1, 1e-9);
    near(sampleLinear(p, 0.75), 0.5, 1e-9);
    near(sampleLinear(p, 1), 0, 1e-9);
    near(sampleLinear(p, -5), 0, 1e-9, 'левее — первая точка');
    near(sampleLinear(p, 5), 0, 1e-9, 'правее — последняя точка');
});

test('sampleStep: значение держится до следующей точки', () => {
    const p = normalizePoints([{ x: 0, y: 1 }, { x: 0.5, y: 2 }, { x: 1, y: 3 }]);
    eq(sampleStep(p, 0), 1);
    eq(sampleStep(p, 0.49), 1);
    eq(sampleStep(p, 0.5), 2);
    eq(sampleStep(p, 0.99), 2);
    eq(sampleStep(p, 1), 3);
});

test('sampleSpline: проходит через точки и остаётся в разумных пределах', () => {
    const p = normalizePoints([0, 1, 0]);
    near(sampleSpline(p, 0), 0, 1e-9, 'первая точка');
    near(sampleSpline(p, 0.5), 1, 1e-9, 'середина');
    near(sampleSpline(p, 1), 0, 1e-9, 'последняя точка');
    const values = [0.1, 0.3, 0.7, 0.9].map((t) => sampleSpline(p, t));
    truthy(values.every((v) => v >= -0.01 && v <= 1.01),
           'гладкая кривая не вылетает за пределы: ' + values.map((v) => v.toFixed(2)).join(','));
});

test('sampleSpline: считает по значениям, а не по индексам (неровные x)', () => {
    const p = normalizePoints([{ x: 0, y: 0 }, { x: 0.9, y: 1 }, { x: 1, y: 0 }]);
    truthy(sampleSpline(p, 0.9) > 0.95, 'в явной точке значение близко к 1');
    truthy(sampleSpline(p, 0.1) < 0.5, 'в начале кривая низкая');
});

test('colorToBytes: hex, короткий hex, alpha, rgb и число', () => {
    eq(colorToBytes('#ff8000').join(','), '255,128,0,255');
    eq(colorToBytes('#f80').join(','), '255,136,0,255');
    eq(colorToBytes('#ff800080').join(','), '255,128,0,128');
    eq(colorToBytes('rgb(10, 20, 30)').join(','), '10,20,30,255');
    eq(colorToBytes('transparent').join(','), '0,0,0,0');
    const packed = packColorBytes([255, 128, 0, 255]);
    eq(colorToBytes(packed).join(','), '255,128,0,255', 'число разбирается обратно');
});

test('makeCurve: режимы и полезные методы', () => {
    const linear = makeCurve([0, 1]);
    eq(linear(0.5), 0.5);
    eq(linear.mode, 'linear');
    eq(linear.points().length, 2);
    near(linear.at(2), 1, 1e-9, 'at зажимает t');
    eq(linear.range(3).join(','), '0,0.5,1');
    const stepped = makeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 1 }], { mode: 'step' });
    eq(stepped(0.4), 0);
    eq(stepped(0.5), 1);
});

test('makeCurve.plus складывает кривые по точкам', () => {
    const a = makeCurve([0, 1]);
    const b = makeCurve([1, 0]);
    const sum = a.plus(b);
    eq(sum(0), 1);
    eq(sum(0.5), 1);
    eq(sum(1), 1);
    const shifted = a.plus(2);
    eq(shifted(0), 2);
    eq(shifted(1), 3);
});

test('makeGradient: строка со стрелками и покомпонентная интерполяция', () => {
    const g = makeGradient('#000000 → #ffffff');
    const mid = g.at(0.5);
    eq(mid.join(','), '128,128,128,255');
    const packed = g(0);
    eq(colorToBytes(packed).join(','), '0,0,0,255');
    eq(g.stops().length, 2);
});

test('makeGradient: стопы объектами, альфа и крайние значения', () => {
    const g = makeGradient([
        { at: 0, color: '#ff000080' },
        { at: 1, color: '#0000ff00' },
    ]);
    eq(g.at(0).join(','), '255,0,0,128');
    eq(g.at(1).join(','), '0,0,255,0');
    const quarter = g.at(0.5);
    truthy(quarter[0] > 100 && quarter[2] > 100, 'середина смешивает каналы');
    truthy(quarter[3] > 50 && quarter[3] < 80, 'альфа тоже интерполируется');
    eq(makeGradient([]).at(0.5).join(','), '255,255,255,255', 'пустой градиент — белый');
});

test('makeGradient: ступенчатый режим не размывает', () => {
    // Ступенька держит значение до СЛЕДУЮЩЕГО стопа, поэтому цвет меняется
    // ровно в 1.0, а не в середине.
    const g = makeGradient(['#000000', '#ffffff'], { mode: 'step' });
    eq(g.at(0).join(','), '0,0,0,255');
    eq(g.at(0.99).join(','), '0,0,0,255');
    eq(g.at(1).join(','), '255,255,255,255');
});

finish();
