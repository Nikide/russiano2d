// ===========================================================================
// Юнит-тесты мелких служебных модулей: bootstrap, index, script.
//
// Эти три не покрывались отдельно, хотя именно их ошибки бьют по всему API:
// bootstrap собирает `$`, index отдаёт его по импорту, script просит движок о
// горячей перезагрузке. Проверяем это без движка.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/small_modules_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { installScript } from '../../src/highlevel/script.js';
import { engine as nativeEngine, setEngineForTests } from '../../src/highlevel/native.js';

test('bootstrap: метка выполнения и готовый $ в globalThis', async () => {
    await import('../../src/highlevel/bootstrap.js');
    eq(globalThis.__r2d_boot_started, true, 'метка «модуль выполнился» поставлена');
    truthy(globalThis.$, 'globalThis.$ появился');
    truthy(typeof globalThis.$.ready === 'function', '$.ready есть');
    eq(globalThis.nk, globalThis.$, 'короткий алиас указывает на тот же объект');
    eq(String(globalThis.__r2d_boot_error || ''), '', 'ошибки установки нет');
});

test('index: отдаёт ТОТ ЖЕ объект, а не второй экземпляр', async () => {
    const mod = await import('../../src/highlevel/index.js');
    eq(mod.default, globalThis.$, 'импорт по умолчанию — тот же $');
    truthy(mod.$, 'именованный экспорт есть');
    eq(mod.$, globalThis.$, 'и он тоже тот же объект');
});

test('bootstrap: игре движок не виден — globalThis.engine убран', async () => {
    await import('../../src/highlevel/bootstrap.js');
    eq(typeof globalThis.engine, 'undefined', 'после установки $ глобального engine нет');
});

test('script: подсистема ставится без движка и честно отказывает', () => {
    // Мок харнесса: неизвестный метод — no-op, то есть «движок ничего не умеет».
    const $ = {};
    installScript($);
    truthy($.script, '$.script установлена');
    falsy($.script.request(), 'запрос перезагрузки без движка — false');
    falsy($.script.hotReload(), 'горячей перезагрузки без движка нет');
    falsy($.script.pending(), 'нет ожидающей перезагрузки');
});

test('script: с движком пробрасывает запрос и отдаёт ответ', () => {
    const saved = nativeEngine;
    const calls = [];
    setEngineForTests({
        requestReload: (reason) => { calls.push(reason); return true; },
        hotReload: () => true,
        reloadPending: () => true,
    });
    try {
        const $ = {};
        installScript($);
        truthy($.script.request('тест'), 'движок принял запрос');
        eq(calls.join(','), 'тест', 'причина дошла до движка');
        truthy($.script.hotReload(), 'горячая перезагрузка включена');
        truthy($.script.pending(), 'перезагрузка ожидается');
        $.script.request();
        eq(calls[1], 'запрос игры', 'без причины подставляется текст по умолчанию');
    } finally {
        setEngineForTests(saved);
    }
});

finish();
