// ===========================================================================
// Real2D v4: чистые функции модуля и установка без движка.
//
// Растеризация и контейнер живут в C (src/real2d4.c), поэтому здесь
// проверяется то, что обязано быть верным без движка: нормализация угла и
// состояния, установка тега <real2d>, маршрутизация вызовов в нативное ядро и
// автоповорот в тике.
//
// Запуск: build/_deps/quickjs-build/qjs tests/js/real2d_test.mjs
// ===========================================================================
import { test, eq, near, truthy, finish } from './_harness.mjs';
import { normalizeReal2dYaw, normalizeReal2dState, installReal2d, tickReal2d } from '../../src/highlevel/real2d.js';
import { createApi } from '../../src/highlevel/api.js';

const throws = (fn) => {
    let bad = false;
    try { fn(); } catch (error) { bad = true; }
    truthy(bad);
};

test('yaw приводится к (-π, π] и не зависит от числа оборотов', () => {
    near(normalizeReal2dYaw(0), 0, 1e-12);
    near(normalizeReal2dYaw(Math.PI * 2), 0, 1e-12);
    near(normalizeReal2dYaw(Math.PI * 4 + 0.5), 0.5, 1e-9);
    near(normalizeReal2dYaw(-0.5), -0.5, 1e-9);
    near(normalizeReal2dYaw(-Math.PI * 2 - 0.5), -0.5, 1e-9);
    near(normalizeReal2dYaw(Math.PI), Math.PI, 1e-9);
    throws(() => normalizeReal2dYaw('0.5'));
    throws(() => normalizeReal2dYaw(NaN));
});

test('состояние сжимается в [0,1], мусор — в ноль', () => {
    eq(normalizeReal2dState(-3), 0);
    eq(normalizeReal2dState(7), 1);
    eq(normalizeReal2dState(0.5), 0.5);
    eq(normalizeReal2dState('0.25'), 0.25);
    eq(normalizeReal2dState(NaN), 0);
    eq(normalizeReal2dState(undefined), 0);
});

test('установка тега и маршрутизация в нативное ядро', () => {
    const calls = [];
    engine.real2d = {
        load: (path) => { calls.push(['load', path]); return 3; },
        render: (id, opts) => { calls.push(['render', id, opts.yaw, opts.blink, opts.mouth, opts.scale]); return 77; },
        pixels: () => new ArrayBuffer(512 * 512 * 4),
        info: (id) => ({ canvas: 512, rank: 6, patches_drawn: 12, ok: true, id }),
        provenance: (id, x, y) => ({ patch: 'face_front', triangle: 1, x, y }),
        debugSetAtlas: () => true,
        dispose: (id) => { calls.push(['dispose', id]); return true; },
    };
    const $ = createApi();
    installReal2d($);
    const node = $('<real2d>', { id: 'head' }).at(100, 100).size(512, 512);
    node.real2dSrc('assets/head.r2d4');
    eq(node.get(0).real2d.id, 3);
    eq(calls[0][0], 'load');
    eq(calls[0][1], 'assets/head.r2d4');
    eq(calls[1][0], 'render');
    near(calls[1][2], 0, 1e-9);
    node.real2dPose(Math.PI / 2, { blink: 2, mouth: -1 });
    near(calls[2][2], Math.PI / 2, 1e-9);
    eq(calls[2][3], 1);
    eq(calls[2][4], 0);
    eq(node.real2dInfo().rank, 6);
    eq($.real2d.pixels(3).length, 512 * 512 * 4);
    eq($.real2d.provenance(3, 5, 5).patch, 'face_front');
    const same = $.real2d.load('assets/head.r2d4');
    eq(same, 3);
    eq(calls.filter((c) => c[0] === 'load').length, 1);
    // Узел держит ссылку на модель: при удалении он её отпускает, а сам ассет
    // живёт, пока на него есть другие ссылки (кэш по пути).
    node.remove();
    truthy(node.get(0).real2d === null, 'узел отпустил модель');
    $.real2d.dispose(3);
    truthy(calls.some((c) => c[0] === 'dispose'), 'ассет освобождён явно');
});

test('автоповорот идёт игровым временем и пересчитывает кадр', () => {
    const angles = [];
    engine.real2d = {
        load: () => 5,
        render: (id, opts) => { angles.push(opts.yaw); return 1; },
        pixels: () => new ArrayBuffer(4),
        info: () => ({ canvas: 128, ok: true }),
        provenance: () => null,
        debugSetAtlas: () => true,
        dispose: () => true,
    };
    const $ = createApi();
    installReal2d($);
    const node = $('<real2d>').real2dSrc('a.r2d4');
    node.real2dSpin(1);
    tickReal2d(0.5);
    near(angles[angles.length - 1], 0.5, 1e-9);
    tickReal2d(0.5);
    near(angles[angles.length - 1], 1.0, 1e-9);
    node.real2dSpin(0);
    const before = angles.length;
    tickReal2d(1);
    eq(angles.length, before, 'без вращения кадр не пересчитывается');
});

test('без нативного real2d модуль сообщает об этом, а не молчит', () => {
    engine.real2d = undefined;
    const $ = createApi();
    installReal2d($);
    // Путь не из кэша: иначе модуль вернёт ранее загруженный id и не тронет ядро.
    throws(() => $.real2d.load('нет-такого-контейнера.r2d4'));
});

finish();
