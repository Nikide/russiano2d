// ===========================================================================
// Лёгкий харнесс для юнит-тестов модулей $ без движка.
//
// Зачем: высокоуровневое API встраивается в бинарник при сборке, поэтому
// проверить логику модуля (A*, раскладку тайлов, эволюцию частиц, парсинг
// prefab) можно только через qjs — за секунды и без сборки движка.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/<модуль>_test.mjs
//
// Мок engine подставляется прокси: неизвестный метод — no-op. Модуль должен
// импортироваться, не обращаясь к engine на верхнем уровне; вся работа с
// движком — внутри install*() и tick*().
// ===========================================================================

const noop = () => 0;

const engine_base = {
    width: 800,
    height: 600,
    dt: 1 / 60,
    frame: 0,
    time: 0,
    seed: 12345,
    agent: false,
    headless: true,
    whiteSprite: 0,
    rgba: (r, g, b, a) => (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0,
    log: () => {},
    measureText: (text, size) => String(text).length * (size || 20) * 0.5,
    keysPressed: () => [],
    keysReleased: () => [],
    mouseDelta: () => ({ x: 0, y: 0 }),
    getTransforms: () => new Float32Array(0),
};

globalThis.engine = new Proxy(engine_base, {
    get(target, key) {
        if (key in target) return target[key];
        return noop;
    },
    has() { return true; },
});

let passed = 0;
const failures = [];

/** Проверка: fn выполняется, исключение = провал. */
export function test(name, fn) {
    try {
        fn();
        passed++;
        print('  ok   ' + name);
    } catch (error) {
        failures.push(name + ': ' + (error && error.message ? error.message : error));
        print('  FAIL ' + name + ' — ' + (error && error.message ? error.message : error));
    }
}

function fail(message) { throw new Error(message); }

/** Строгое равенство (примитивы и ссылки). */
export function eq(actual, expected, message) {
    if (actual !== expected) {
        fail((message ? message + ': ' : '') + 'ожидалось ' + JSON.stringify(expected) +
             ', получено ' + JSON.stringify(actual));
    }
}

/** Приблизительное равенство чисел. */
export function near(actual, expected, eps, message) {
    const e = eps === undefined ? 1e-6 : eps;
    if (!(Math.abs(actual - expected) <= e)) {
        fail((message ? message + ': ' : '') + 'ожидалось ~' + expected + ', получено ' + actual);
    }
}

export function truthy(value, message) {
    if (!value) fail((message || 'ожидалось истинное значение') + ', получено ' + JSON.stringify(value));
}

export function falsy(value, message) {
    if (value) fail((message || 'ожидалось ложное значение') + ', получено ' + JSON.stringify(value));
}

/** Массив аргументов → строка, чтобы удобно сравнивать. */
export function joined(list, sep) { return Array.from(list).join(sep === undefined ? ',' : sep); }

/** Итог: при провалах бросает исключение, и qjs возвращает код 1. */
export function finish() {
    if (failures.length) {
        print('ПРОВАЛЕНО ' + failures.length + ' из ' + (passed + failures.length));
        for (const f of failures) print('  - ' + f);
        throw new Error('тест не пройден: ' + failures.length);
    }
    print('Все проверки пройдены (' + passed + ')');
}
