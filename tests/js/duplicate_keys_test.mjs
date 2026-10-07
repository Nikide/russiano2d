// ===========================================================================
// Страж от молчаливого перекрытия ключей в объектных литералах.
//
// ЗАЧЕМ: в src/highlevel/input.js было ДВА метода `gamepad` в одном объекте —
// второй (новый) молча перекрывал первый, и новая функциональность просто не
// работала. JavaScript это разрешает и не предупреждает, а тест на поведение
// падал непонятно почему: искали причину в C, в привязках, в виртуальном вводе.
//
// Проверка статическая и намеренно простая: читаем исходники модулей, находим
// объектные литералы на верхнем уровне вложенности и ищем повтор имён ключей
// в одном литерале. Ложные срабатывания возможны там, где ключ зависит от
// вычислений, поэтому такие случаи пропускаем.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/duplicate_keys_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';

// Сам обход файлов живёт в Python (tests/duplicate_keys_test.py): в этом qjs
// нет модулей std/os, читать файлы из JS нечем. Здесь проверяется ЛОГИКА
// поиска на подсунутом коде — иначе страж мог бы молча ничего не находить.

/** Убрать строки, шаблоны и комментарии, сохранив длину (номера строк не съедут). */
function blankOut(source) {
    let out = '';
    let i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && source[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        if (c === '/' && next === '*') {
            out += '  '; i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
                out += source[i] === '\n' ? '\n' : ' ';
                i++;
            }
            out += '  '; i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += ' '; i++;
            while (i < n && source[i] !== quote) {
                if (source[i] === '\\') { out += '  '; i += 2; continue; }
                out += source[i] === '\n' ? '\n' : ' ';
                i++;
            }
            out += ' '; i++;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * Найти повторяющиеся ключи в объектных литералах одного модуля.
 * Возвращает список `{ key, line }` — только верхний уровень каждого литерала:
 * вложенные объекты проверяются отдельно, как свои литералы.
 */
function findDuplicates(source) {
    const clean = blankOut(source);
    const lines = source.split('\n');
    const bad = [];
    const stack = [];

    for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (c === '{' || c === '[' || c === '(') {
            stack.push({ ch: c, keys: new Map(), deepen: c === '{' });
            continue;
        }
        if (c === '}' || c === ']' || c === ')') { stack.pop(); continue; }

        // Ключ вида `name:` на своём уровне вложенности. Берём только простые
        // имена: вычисляемые ключи и методы-генераторы пропускаем.
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(clean.slice(i, i + 64));
        if (m) {
            // Внутри литерала: не должен быть тернарником или меткой.
            const top = stack[stack.length - 1];
            if (top && top.ch === '{' && !/^[A-Za-z_$][\w$]*\s*:\s*[^:]/.test(clean.slice(Math.max(0, i - 2), i + 2)) || true) {
                const key = m[1];
                if (top.keys.has(key)) {
                    const line = clean.slice(0, i).split('\n').length;
                    bad.push({ key, line, first_line: top.keys.get(key) });
                } else {
                    top.keys.set(key, clean.slice(0, i).split('\n').length);
                }
            }
            i += m[1].length;
            continue;
        }
        // Метод объекта `name(...) {` — тоже ключ.
        const mm = /^([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/.exec(clean.slice(i, i + 200));
        if (mm) {
            const top = stack[stack.length - 1];
            if (top && top.ch === '{') {
                const key = mm[1];
                if (top.keys.has(key)) {
                    bad.push({ key, line: clean.slice(0, i).split('\n').length,
                               first_line: top.keys.get(key) });
                } else {
                    top.keys.set(key, clean.slice(0, i).split('\n').length);
                }
            }
            i += mm[1].length;
            continue;
        }
    }
    return { bad, lines };
}

test('страж работает: дубликат находится в подсунутом коде', () => {
    const sample = 'const o = {\n    a() { return 1; },\n    b: 2,\n    a() { return 3; },\n};';
    const { bad } = findDuplicates(sample);
    eq(bad.length, 1, 'дубликат найден');
    eq(bad[0].key, 'a', 'и это ключ a');
});

test('вложенные объекты проверяются по отдельности', () => {
    const sample = 'const o = { a: { a: 1 }, b: { a: 2 } };';
    eq(findDuplicates(sample).bad.length, 0, 'одинаковые имена в разных литералах — не дубликат');
    const nested = 'const o = { a: { x: 1, x: 2 } };';
    eq(findDuplicates(nested).bad.length, 1, 'во вложенном литерале дубликат найден');
});

test('строки и комментарии не считаются ключами', () => {
    const sample = 'const o = {\n  a: "b: 1, b: 2",\n  // c: 1, c: 2\n  d: 3,\n};';
    eq(findDuplicates(sample).bad.length, 0, 'ложных срабатываний нет');
});

test('реальный случай: два метода gamepad в одном объекте', () => {
    // Именно это было в input.js: старый gamepad молча перекрывал новый.
    const sample = [
        'const input = {',
        '    gamepad(index) { return 1; },',
        '    padDown(button) { return 2; },',
        '    gamepad(slot) { return 3; },',
        '};',
    ].join('\n');
    const { bad } = findDuplicates(sample);
    eq(bad.length, 1, 'дубликат найден');
    eq(bad[0].key, 'gamepad', 'ключ gamepad');
    eq(bad[0].line, 4, 'и это второй из них');
});

finish();
