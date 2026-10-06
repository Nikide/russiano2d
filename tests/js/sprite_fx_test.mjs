// ===========================================================================
// Юнит-тест описания шейдера узла (qjs).
//
// .shader('flash', {...}) на JS-стороне превращается в четвёрку чисел и цвет,
// которые уезжают в шейдер sprite_fx.frag.glsl. Ошибка здесь не падает —
// просто эффект выглядит не тем, чем задуман, поэтому разбор проверяется без
// движка.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/sprite_fx_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { fxSpec, fxKinds } from '../../src/highlevel/render.js';

test('список видов эффектов совпадает с шейдером', () => {
    const kinds = fxKinds();
    for (const name of ['none', 'flash', 'dissolve', 'chroma', 'wave']) {
        truthy(kinds.indexOf(name) >= 0, `в списке есть '${name}'`);
    }
});

test('none и неизвестное имя — это отсутствие эффекта', () => {
    eq(fxSpec('none').kind, 0);
    eq(fxSpec('нет-такого').kind, 0);
    eq(fxSpec(undefined).kind, 0);
});

test('flash: вид 1, сила зажата в 0..1, цвет переносится как есть', () => {
    const s = fxSpec('flash', { amount: 0.7, color: '#ff8080' });
    eq(s.kind, 1);
    near(s.p1, 0.7);
    eq(s.color, '#ff8080');

    near(fxSpec('flash', { amount: 5 }).p1, 1, 1e-9, 'сила обрезана сверху');
    near(fxSpec('flash', { amount: -1 }).p1, 0, 1e-9, 'и снизу');
    near(fxSpec('flash').p1, 0.8, 1e-9, 'умолчание — 0.8');
});

test('dissolve: порог, масштаб шума и цвет кромки по умолчанию', () => {
    const s = fxSpec('dissolve', { threshold: 0.35, scale: 48 });
    eq(s.kind, 2);
    near(s.p1, 0.35);
    near(s.p2, 48);
    eq(s.color, '#ff8844', 'цвет кромки по умолчанию тёплый');

    const d = fxSpec('dissolve', {});
    near(d.p1, 0.5, 1e-9, 'порог по умолчанию — половина');
    near(d.p2, 64, 1e-9, 'масштаб шума по умолчанию — 64');
    eq(d.color, '#ff8844', 'кромка по умолчанию тёплая');
});

test('chroma: смещение каналов и умолчание', () => {
    const s = fxSpec('chroma', { offset: 0.02 });
    eq(s.kind, 3);
    near(s.p1, 0.02);
    near(fxSpec('chroma').p1, 0.01, 1e-9);
});

test('wave: амплитуда, частота и фаза (время)', () => {
    const s = fxSpec('wave', { amplitude: 0.05, frequency: 30, phase: 1.5 });
    eq(s.kind, 4);
    near(s.p1, 0.05);
    near(s.p2, 30);
    near(s.p3, 1.5);
    near(fxSpec('wave', { amount: 0.02 }).p1, 0.02, 1e-9, 'amount — псевдоним амплитуды');
    near(fxSpec('wave').p2, 24, 1e-9, 'частота по умолчанию — 24');
});

test('мусор в параметрах не превращается в NaN', () => {
    const s = fxSpec('wave', { amplitude: 'широкая', frequency: null });
    truthy(Number.isFinite(s.p1), 'амплитуда — число');
    truthy(Number.isFinite(s.p2), 'частота — число');
    near(s.p1, 0.03, 1e-9);
    near(s.p2, 24, 1e-9);
});

finish();
