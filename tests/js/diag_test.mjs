// ===========================================================================
// Юнит-тесты диагностики (§17 Спецификации) — без движка.
//
// Проверяется то, что спецификация называет контрактом: форма записи
// (code/subsystem/operation/recoverable/nodeId/assetPath/source), классификация
// по подписи места, подавление повторов со видимым счётчиком потерь и сводка,
// по которой приёмка решает, чист ли прогон.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/diag_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { classify, sourceOf, report, reportException, list, summary, clear } from '../../src/highlevel/diag.js';

test('классификация: callback $, сцена, событие узла, прочее', () => {
    eq(classify('$.ready').code, 'R2D_SCRIPT_CALLBACK', '$.ready — callback');
    eq(classify('$.ready').subsystem, 'ready', 'подсистема из имени');
    eq(classify('$.update').subsystem, 'update', '$.update');
    eq(classify('update сцены').code, 'R2D_SCENE_UPDATE', 'сцена: update');
    eq(classify('render сцены').code, 'R2D_SCENE_RENDER', 'сцена: render');
    eq(classify('событие collide').code, 'R2D_NODE_EVENT', 'событие узла');
    eq(classify('что-то своё').code, 'R2D_ERROR', 'неизвестное — общий код');
    eq(classify('что-то своё').subsystem, 'engine', 'и общая подсистема');
});

test('запись: фиксированная форма и поля §17', () => {
    clear();
    const e = report('$.update', new Error('boom'), { nodeId: 'n7', assetPath: 'a/b.png' });
    eq(e.code, 'R2D_SCRIPT_CALLBACK', 'код');
    eq(e.subsystem, 'update', 'подсистема');
    eq(e.operation, '$.update', 'операция');
    eq(e.message, 'boom', 'сообщение из Error');
    eq(e.nodeId, 'n7', 'nodeId проброшен');
    eq(e.assetPath, 'a/b.png', 'assetPath проброшен');
    eq(e.recoverable, true, 'по умолчанию ошибка устранима');
    truthy(typeof e.frame === 'number', 'frame — число');
    truthy(e.seq >= 1, 'порядковый номер есть');
    eq(list().length, 1, 'запись попала в журнал');
});

test('fatal: неустранимая ошибка меняет recoverable и сводку', () => {
    clear();
    const e = report('load', new Error('нет ассета'), { fatal: true, assetPath: 'x.png', code: 'R2D_ASSET_MISSING' });
    eq(e.recoverable, false, 'fatal → recoverable false');
    const s = summary();
    eq(s.clean, false, 'журнал не чист: есть неустранимая');
    eq(s.fatal, 1, 'счётчик неустранимых');
    eq(s.by_code.R2D_ASSET_MISSING, 1, 'сводка по коду');
    eq(s.by_subsystem.engine, 1, 'подсистема по месту сохранена, когда её не задали');
});

test('явный код и подсистема старше автоматических', () => {
    clear();
    const e = report('$.update', new Error('x'), { code: 'R2D_CUSTOM', subsystem: 'audio' });
    eq(e.code, 'R2D_CUSTOM', 'код из opts');
    eq(e.subsystem, 'audio', 'подсистема из opts');
    eq(summary().by_code.R2D_CUSTOM, 1, 'сводка по явному коду');
});

test('sourceOf: файл и строка из стека QuickJS', () => {
    const err = new Error('x');
    err.stack = 'boom\n    at foo (r2d/api.js:120:5)\n    at bar (main.js:7:1)';
    const src = sourceOf(err);
    eq(src.file, 'r2d/api.js', 'файл первого кадра');
    eq(src.line, 120, 'строка');
    eq(sourceOf(null), null, 'null — null');
    const bare = new Error('без стека');
    bare.stack = '';
    eq(sourceOf(bare), null, 'пустой стек — null');
});

test('подавление повторов: считаем, но не заливаем лог', () => {
    clear();
    for (let i = 0; i < 20; i++) report('$.update', new Error('одно и то же'));
    const s = summary();
    eq(s.total, 20, 'все повторы записаны в журнал');
    eq(s.suppressed, 17, 'напечатаны первые 3, остальные подавлены (17)');
    eq(list().length, 20, 'журнал хранит все записи');
});

test('кольцо ограничено: старые вытесняются со счётчиком', () => {
    clear();
    for (let i = 0; i < 200; i++) report('$.update', new Error('уникальное ' + i));
    const s = summary();
    truthy(s.dropped > 0, 'счётчик вытесненных растёт (' + s.dropped + ')');
    truthy(list().length <= 128, 'в журнале не больше лимита');
    eq(list()[list().length - 1].message, 'уникальное 199', 'последняя запись на месте');
});

test('reportException принимает не-Error значения', () => {
    clear();
    const e = reportException('$.render', 'строка как исключение');
    eq(e.message, 'строка как исключение', 'текст без Error');
    eq(e.code, 'R2D_SCRIPT_CALLBACK', 'классификация по месту');
});

test('clear обнуляет журнал и счётчики', () => {
    clear();
    report('$.update', new Error('x'));
    clear();
    const s = summary();
    eq(s.total, 0, 'журнал пуст');
    eq(s.dropped, 0, 'вытесненные сброшены');
    eq(s.suppressed, 0, 'подавленные сброшены');
    eq(list().length, 0, 'list пуст');
});

test('summary.clean зависит только от неустранимых', () => {
    clear();
    report('$.update', new Error('мелочь'));
    eq(summary().clean, true, 'устранимая ошибка не делает журнал грязным');
    report('load', new Error('провал'), { fatal: true });
    eq(summary().clean, false, 'неустранимая делает');
});

finish();
