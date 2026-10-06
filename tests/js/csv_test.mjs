// ===========================================================================
// Юнит-тест $.csv — разбор и сборка CSV/TSV, таблицы с заголовком, JSON.
//
//   build/_deps/quickjs-build/qjs tests/js/csv_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, joined, finish } from './_harness.mjs';
import {
    parse, parseTable, stringify, detectDelimiter, quoteField,
    jsonParse, jsonStringify, installCsv,
} from '../../src/highlevel/csv.js';

// --- Разбор ----------------------------------------------------------------

test('parse простого CSV', () => {
    const rows = parse('a,b,c\n1,2,3');
    eq(rows.length, 2);
    eq(joined(rows[0]), 'a,b,c');
    eq(joined(rows[1]), '1,2,3');
    eq(rows[0].length, 3);
});

test('parse пустого текста даёт пустой массив', () => {
    eq(parse('').length, 0);
    eq(parse(null).length, 0);
    eq(parse(undefined).length, 0);
});

test('parse: запятая внутри кавычек не делит поле', () => {
    const rows = parse('a,"b,c",d');
    eq(rows[0].length, 3);
    eq(rows[0][1], 'b,c');
});

test('parse: удвоенная кавычка внутри поля', () => {
    const rows = parse('"он сказал ""привет""",x');
    eq(rows[0][0], 'он сказал "привет"');
    eq(rows[0][1], 'x');
});

test('parse: перевод строки внутри кавычек не рвёт строку', () => {
    const rows = parse('a,"первая\nвторая",c');
    eq(rows.length, 1, 'запись осталась одной');
    eq(rows[0].length, 3);
    eq(rows[0][1], 'первая\nвторая');
});

test('parse: CRLF и одиночный CR — один перевод строки', () => {
    const rows = parse('a,b\r\n1,2\r');
    eq(rows.length, 2);
    eq(joined(rows[1]), '1,2');
    truthy(rows[0][1].indexOf('\r') < 0, 'символ возврата каретки не попал в поле');
});

test('parse: последний перевод строки не создаёт лишнюю запись', () => {
    eq(parse('a,b\n').length, 1);
    eq(parse('a,b\n\n').length, 2, 'а настоящая пустая строка — создаёт');
    eq(joined(parse('a,b\n')[0]), 'a,b');
});

test('parse: пустая строка в середине — это одна пустая запись', () => {
    const rows = parse('a\n\nb');
    eq(rows.length, 3);
    eq(rows[1].length, 1);
    eq(rows[1][0], '');
});

test('parse: skipEmptyLines выбрасывает пустые строки', () => {
    const rows = parse('a\n\nb\n', { skipEmptyLines: true });
    eq(rows.length, 2);
    eq(joined(rows, '|'), 'a|b');
});

test('parse: trim обрезает пробелы, по умолчанию они значимы', () => {
    eq(parse(' a , b ')[0][0], ' a ');
    const rows = parse(' a , b ', { trim: true });
    eq(rows[0][0], 'a');
    eq(rows[0][1], 'b');
});

test('detectDelimiter: точка с запятой, табуляция, вертикальная черта', () => {
    eq(detectDelimiter('a;b;c\n1;2;3'), ';');
    eq(detectDelimiter('a\tb\tc'), '\t');
    eq(detectDelimiter('a|b|c'), '|');
    eq(detectDelimiter('одно поле'), ',', 'без разделителей — запятая');
});

test('detectDelimiter не считает разделители внутри кавычек', () => {
    eq(detectDelimiter('"a,b";c'), ';');
    eq(detectDelimiter('"a;b",c'), ',');
});

test('parse с явным разделителем', () => {
    const rows = parse('a;b', { delimiter: ';' });
    eq(rows[0].length, 2);
    eq(joined(rows[0]), 'a,b');
    const tsv = parse('a\tb\n1\t2', { delimiter: '\t' });
    eq(tsv.length, 2);
    eq(tsv[1][1], '2');
});

// --- Таблица с заголовком --------------------------------------------------

test('parseTable берёт ключи из первой строки', () => {
    const items = parseTable('name,damage\nмеч,10\nщит,5');
    eq(items.length, 2);
    eq(items[0].name, 'меч');
    eq(items[0].damage, '10');
    eq(items[1].name, 'щит');
});

test('parseTable на пустом тексте даёт пустой массив', () => {
    eq(parseTable('').length, 0);
    eq(parseTable('name,damage').length, 0, 'одна строка заголовка — данных нет');
});

test('parseTable с готовыми ключами считает первую строку данными', () => {
    const items = parseTable('1,2\n3,4', { keys: ['x', 'y'] });
    eq(items.length, 2);
    eq(items[0].x, '1');
    eq(items[1].y, '4');
});

test('parseTable: пустой и повторяющийся заголовок получают имена', () => {
    const items = parseTable(',a,a\n1,2,3');
    eq(items.length, 1);
    eq(items[0].col1, '1', 'пустая колонка названа col1');
    eq(items[0].a, '2');
    eq(items[0].a_2, '3', 'повтор получил суффикс');
});

test('parseTable: короткая строка добивается пустыми полями', () => {
    const items = parseTable('a,b,c\n1');
    eq(items[0].a, '1');
    eq(items[0].b, '');
    eq(items[0].c, '');
});

test('parseTable: кавычки и переводы строк работают как в parse', () => {
    const items = parseTable('name,note\nмеч,"острое,\nно хрупкое"');
    eq(items[0].note, 'острое,\nно хрупкое');
});

// --- Сборка ----------------------------------------------------------------

test('stringify собирает простую таблицу', () => {
    eq(stringify([['a', 'b'], ['1', '2']]), 'a,b\n1,2');
    eq(stringify([]), '');
});

test('stringify экранирует разделитель, кавычку и перевод строки', () => {
    eq(stringify([['a,b']]), '"a,b"');
    eq(stringify([['он сказал "привет"']]), '"он сказал ""привет"""');
    eq(stringify([['первая\nвторая']]), '"первая\nвторая"');
    eq(stringify([[' пробел ']]), '" пробел "');
});

test('stringify: round-trip сохраняет хитрые поля', () => {
    const rows = [['a,b', 'c"d', 'e\nf', ' пробел ', 'обычное']];
    eq(JSON.stringify(parse(stringify(rows))), JSON.stringify(rows));
});

test('stringify: разделитель, перевод строки и заголовок', () => {
    eq(stringify([['a', 'b']], { delimiter: '\t' }), 'a\tb');
    eq(stringify([['a'], ['b']], { eol: '\r\n' }), 'a\r\nb');
    eq(stringify([['1', '2']], { header: ['x', 'y'] }), 'x,y\n1,2');
});

test('stringify: объекты берут значения по заголовку', () => {
    const text = stringify([{ name: 'меч', damage: 10 }], { header: ['name', 'damage'] });
    eq(text, 'name,damage\nмеч,10');
    const items = parseTable(text);
    eq(items[0].damage, '10');
});

test('stringify: null, undefined, число и объект', () => {
    eq(stringify([[null, undefined]]), ',');
    eq(stringify([[5, true]]), '5,true');
    eq(stringify([[{ a: 1 }]]), '"{""a"":1}"', 'объект превращается в JSON и экранируется');
});

test('quoteField кавычит только по необходимости', () => {
    eq(quoteField('abc', ','), 'abc');
    eq(quoteField('a,b', ','), '"a,b"');
    eq(quoteField('a;b', ','), 'a;b');
    eq(quoteField('a"b', ','), '"a""b"');
    eq(quoteField(null, ','), '');
});

// --- JSON ------------------------------------------------------------------

test('jsonParse разбирает корректный JSON', () => {
    const v = jsonParse('{"hp": 10, "items": ["меч"]}');
    eq(v.hp, 10);
    eq(v.items[0], 'меч');
    eq(jsonParse('[1,2,3]').length, 3);
    eq(jsonParse('null'), null);
    eq(jsonParse('42'), 42);
});

test('jsonParse на битом тексте отдаёт запасное значение', () => {
    eq(jsonParse('{битый', 'запас'), 'запас');
    eq(jsonParse('', 'запас'), 'запас');
    eq(jsonParse('   ', 'запас'), 'запас');
    eq(jsonParse(undefined, 'запас'), 'запас');
    eq(jsonParse('{битый'), null, 'без запасного значения — null');
    eq(jsonParse('{битый', 0), 0, 'запасное значение может быть любым');
});

test('jsonStringify собирает JSON и не бросает на несериализуемом', () => {
    eq(jsonStringify({ a: 1 }), '{"a":1}');
    eq(jsonStringify([1, 'два']), '[1,"два"]');
    truthy(jsonStringify({ a: 1 }, true).indexOf('\n') > 0, 'pretty добавляет отступы');
    eq(jsonStringify(undefined), null);
    const loop = {};
    loop.self = loop;
    eq(jsonStringify(loop), null, 'ссылка на себя — null, а не исключение');
});

test('jsonParse и jsonStringify — взаимно обратные', () => {
    const value = { hp: 10, name: 'меч', tags: ['a', 'b'], flag: false };
    eq(JSON.stringify(jsonParse(jsonStringify(value))), JSON.stringify(value));
});

// --- Установка -------------------------------------------------------------

test('installCsv кладёт разбор, сборку и JSON в $.csv', () => {
    const $ = {};
    const csv = installCsv($);
    truthy($.csv === csv, '$.csv установлено');
    truthy($.csv.parse === parse, 'под пространством имён та же функция');
    truthy($.csv.parseTable === parseTable);
    truthy($.csv.stringify === stringify);
    truthy(typeof $.csv.jsonParse === 'function');
    truthy(typeof $.csv.jsonStringify === 'function');
    eq($.csv.parse('a,b')[0][1], 'b');
    eq($.csv.jsonParse('{плохо', 'ок'), 'ок');
});

finish();
