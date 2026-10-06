// ===========================================================================
// Юнит-тест подсистемы viewport без движка (qjs).
//
// Проверяет то, что можно проверить без GPU: нормализацию режимов смешивания,
// приоритет node.blend_mode, нарезку списка на непрерывные участки и честную
// ошибку render target. Сама отрисовка конвейерами проверяется агентским
// тестом tests/agent/highlevel_render_test.py — здесь картинки нет.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/viewport_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, joined, finish } from './_harness.mjs';
import {
    BLEND_MODES,
    DEFAULT_BLEND,
    UNSUPPORTED,
    normalizeBlend,
    nodeBlendMode,
    resolveBlend,
    getDefaultBlend,
    setDefaultBlend,
    blendRuns,
    installViewport,
} from '../../src/highlevel/viewport.js';
import { ctx } from '../../src/highlevel/core.js';

/** Проверка: fn обязана бросить исключение с подстрокой needle. */
function throws(fn, needle) {
    try {
        fn();
    } catch (error) {
        const message = String(error && error.message ? error.message : error);
        truthy(message.includes(needle), `сообщение об ошибке: ${message}`);
        return;
    }
    throw new Error('ожидалось исключение, но его не было');
}

// ---------------------------------------------------------------------------
// Имена режимов
// ---------------------------------------------------------------------------

test('список режимов совпадает с порядком конвейеров в render.c', () => {
    eq(joined(BLEND_MODES), 'alpha,add,multiply,none');
    eq(DEFAULT_BLEND, 'alpha');
});

test('normalizeBlend приводит регистр и пробелы', () => {
    eq(normalizeBlend('add'), 'add');
    eq(normalizeBlend('MULTIPLY'), 'multiply');
    eq(normalizeBlend('  none '), 'none');
    eq(normalizeBlend('alpha'), 'alpha');
});

test('normalizeBlend отвергает мусор, не строку и undefined', () => {
    eq(normalizeBlend('screen'), null);
    eq(normalizeBlend(''), null);
    eq(normalizeBlend(42), null);
    eq(normalizeBlend(undefined), null);
});

test('nodeBlendMode читает node.blend_mode и молчит про неизвестное', () => {
    eq(nodeBlendMode({ blend_mode: 'add' }), 'add');
    eq(nodeBlendMode({ blend_mode: 'Add' }), 'add');
    eq(nodeBlendMode({}), null);
    eq(nodeBlendMode({ blend_mode: 'screen' }), null);
    eq(nodeBlendMode(null), null);
});

test('resolveBlend: node.blend_mode важнее режима по умолчанию', () => {
    const saved = getDefaultBlend();
    setDefaultBlend('multiply');
    eq(resolveBlend({ blend_mode: 'add' }), 'add', 'узел задаёт свой режим');
    eq(resolveBlend({}), 'multiply', 'без режима у узла берётся общий');
    setDefaultBlend(saved);
});

test('setDefaultBlend валидирует и не портит текущее значение', () => {
    const saved = getDefaultBlend();
    eq(setDefaultBlend('nonsense'), null);
    eq(getDefaultBlend(), saved, 'неизвестное имя не меняет режим');
    eq(setDefaultBlend('add'), 'add');
    eq(getDefaultBlend(), 'add');
    setDefaultBlend(saved);
});

// ---------------------------------------------------------------------------
// Нарезка на участки
// ---------------------------------------------------------------------------

test('blendRuns режет только там, где режим реально меняется', () => {
    const items = [
        { id: 1, blend_mode: 'alpha' },
        { id: 2, blend_mode: 'alpha' },
        { id: 3, blend_mode: 'add' },
        { id: 4, blend_mode: 'add' },
        { id: 5, blend_mode: 'alpha' },
    ];
    const runs = blendRuns(items);
    eq(runs.length, 3, 'три непрерывных участка');
    eq(joined(runs.map((r) => r.blend)), 'alpha,add,alpha');
    eq(joined(runs[0].items.map((i) => i.id)), '1,2');
    eq(joined(runs[2].items.map((i) => i.id)), '5');
});

test('blendRuns сохраняет порядок и подставляет режим по умолчанию', () => {
    const saved = getDefaultBlend();
    setDefaultBlend('add');
    const runs = blendRuns([{}, { blend_mode: 'none' }, {}]);
    eq(joined(runs.map((r) => r.blend)), 'add,none,add');
    eq(runs.length, 3, 'порядок элементов сохранён, а не пересортирован');
    setDefaultBlend(saved);
});

test('blendRuns поддерживает свой modeOf и пустой список', () => {
    const runs = blendRuns(['a', 'a', 'b'], (x) => (x === 'a' ? 'add' : 'none'));
    eq(joined(runs.map((r) => r.blend)), 'add,none');
    eq(blendRuns([]).length, 0);
    eq(blendRuns(null).length, 0);
});

// ---------------------------------------------------------------------------
// $.viewport и $.blend
// ---------------------------------------------------------------------------

test('$.viewport без рендерера отвечает null/false, а не бросает', () => {
    // В qjs движка нет: render target живёт в C, поэтому запросы возвращают
    // «нет», а не ломают игру исключением.
    const $ = {};
    installViewport($);

    eq(typeof $.viewport, 'object');
    falsy($.viewport.supported, 'рендерера нет — render target не поддержан');
    eq($.viewport.count(), 0, 'textур нет');
    eq($.viewport.size(0), null, 'size() — null');
    eq($.viewport.create(64, 64), null, 'create() — null');
    eq($.viewport.destroy(0), false, 'destroy() — false');
    eq($.viewport.bind(0), false, 'bind() — false');
    eq($.viewport.unbind(), false, 'unbind() — false');
    eq($.viewport.bound(), null, 'bound() — null');
    eq($.viewport.sprite(0), -1, 'sprite() — -1');
    eq($.viewport.draw(0, 0, 0, 64, 64, {}), false, 'draw() — false');
    truthy(UNSUPPORTED.includes('недоступен'), 'текст ошибки понятен');
});

test('$.blend делегирует в $.gfx.blend, когда gfx уже есть', () => {
    const calls = [];
    const saved = ctx.gfx;
    ctx.gfx = { blend: (name) => { calls.push(name); return name === undefined ? 'current' : name; } };

    const $ = {};
    installViewport($);
    eq($.blend('add'), 'add');
    eq($.blend(), 'current');
    eq(calls.length, 2, 'обёртка не дублирует логику режимов');
    eq(calls[0], 'add', 'сеттер прокидывает имя');
    eq(calls[1], undefined, 'геттер прокидывает undefined');

    ctx.gfx = saved;
});

test('$.blend без gfx валидирует сам и ругается на неизвестное имя', () => {
    const saved = ctx.gfx;
    const saved_log = ctx.log;
    const logs = [];
    ctx.gfx = null;
    ctx.log = (msg) => logs.push(String(msg));

    const $ = {};
    installViewport($);
    setDefaultBlend('alpha');

    eq($.blend('multiply'), 'multiply', 'известный режим ставится');
    eq($.blend(), 'multiply', 'геттер возвращает текущий');
    eq($.blend('screen'), 'multiply', 'неизвестное имя не меняет режим');
    eq(logs.length, 1, 'одно предупреждение');
    truthy(logs[0].includes('неизвестный режим'), 'текст предупреждения');

    ctx.log = saved_log;
    ctx.gfx = saved;
    setDefaultBlend('alpha');
});

finish();
