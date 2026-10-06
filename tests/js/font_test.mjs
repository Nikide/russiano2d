// ===========================================================================
// Юнит-тест текстовых стилей (font.js) без движка.
//
// Проверяет разбор описания стиля, наследование (в том числе неявную базу
// 'default'), выбор свойства для цвета (у кнопки цвет подписи — text_color,
// у <text> — color), поведение на неизвестном стиле, копию из get() и метод
// узла .textStyle().
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/font_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query, packColor } from '../../src/highlevel/core.js';
import {
    installFont, FONT_DEFAULTS, textColorTarget,
    normalizeFontStyle, mergeFontStyles, resolveFontStyle,
} from '../../src/highlevel/font.js';

// --- Мок $ (создание узлов и селекторы) ------------------------------------

function makeDollar() {
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = {};
    return $;
}

// Ядро рассылает глобальные события через ctx.$ — в тесте он не нужен.
ctx.$ = { _dispatchGlobal() {} };

const $ = makeDollar();
const font = installFont($);

// Перехват лога: часть проверок — про предупреждения.
const real_log = ctx.log;
let logs = [];
ctx.log = (msg) => { logs.push(String(msg)); };

function reset() {
    ctx.nodes.length = 0;
    ctx.byId.clear();
    logs = [];
}

/** Новый узел с id — через тот же путь, что и в игре. */
function node(tag, attrs) {
    return $('<' + tag + '>', attrs).get(0);
}

// --- Чистые функции --------------------------------------------------------

test('normalizeFontStyle держит незаданные поля пустыми (для наследования)', () => {
    const s = normalizeFontStyle('hud', { size: 20 });
    eq(s.name, 'hud');
    eq(s.set.size, 20);
    eq(s.set.color, undefined);
    eq(s.set.align, undefined);
});

test('mergeFontStyles: дочерний стиль перекрывает только заданное', () => {
    const base = normalizeFontStyle('body', { size: 16, color: '#00ff00', align: 'center' });
    const over = normalizeFontStyle('title', { size: 32 });
    const merged = resolveFontStyle(mergeFontStyles(base, over));
    eq(merged.size, 32);
    eq(merged.color, '#00ff00');
    eq(merged.align, 'center');
});

test('resolveFontStyle дополняет стиль значениями по умолчанию', () => {
    const s = resolveFontStyle(normalizeFontStyle('x', {}));
    eq(s.size, FONT_DEFAULTS.size);
    eq(s.color, FONT_DEFAULTS.color);
    eq(s.align, FONT_DEFAULTS.align);
    eq(s.lineHeight, FONT_DEFAULTS.lineHeight);
});

test('textColorTarget: у контролов цвет подписи — text_color', () => {
    eq(textColorTarget('ui.button'), 'text');
    eq(textColorTarget('ui.input'), 'text');
    eq(textColorTarget('ui.label'), 'color');
    eq(textColorTarget('text'), 'color');
});

// --- Реестр ----------------------------------------------------------------

test('define + get: разобранный стиль с значениями по умолчанию', () => {
    font.define('hud', { size: 20, color: '#ffffff', align: 'left' });
    const style = font.get('hud');
    eq(style.name, 'hud');
    eq(style.size, 20);
    eq(style.color, '#ffffff');
    eq(style.align, 'left');
    near(style.lineHeight, FONT_DEFAULTS.lineHeight);
});

test('get неизвестного стиля возвращает null, has/list это подтверждают', () => {
    eq(font.get('нет-такого'), null);
    eq(font.has('нет-такого'), false);
    eq(font.has('hud'), true);
    truthy(font.list().includes('hud'));
});

test('list() отдаёт имена по алфавиту, remove() убирает стиль', () => {
    font.define('aaa', { size: 10 });
    font.define('zzz', { size: 10 });
    const names = font.list();
    eq(names.indexOf('aaa') < names.indexOf('hud'), true, 'aaa раньше hud');
    eq(names.indexOf('hud') < names.indexOf('zzz'), true, 'hud раньше zzz');
    font.remove('aaa');
    eq(font.has('aaa'), false);
});

test('get возвращает копию: правка результата не портит реестр', () => {
    const a = font.get('hud');
    a.size = 999;
    a.extra.чужое = true;
    eq(font.get('hud').size, 20);
    eq(font.get('hud').extra.чужое, undefined);
});

test('неизвестный align подменяется на left с предупреждением', () => {
    reset();
    font.define('кривой', { size: 12, align: 'по-центру' });
    eq(font.get('кривой').align, 'left');
    eq(logs.length, 1);
    truthy(logs[0].includes('кривой'), 'в логе есть имя стиля');
});

// --- Наследование ----------------------------------------------------------

test('base наследует поля родителя и перекрывает заданные', () => {
    font.define('body', { size: 16, color: '#00ff00', align: 'center' });
    font.define('title', { base: 'body', size: 32 });
    const style = font.get('title');
    eq(style.size, 32);
    eq(style.color, '#00ff00');
    eq(style.align, 'center');
});

test('стиль default — неявная база для всех остальных', () => {
    font.define('default', { size: 18, color: '#123456', lineHeight: 2 });
    font.define('plain', {});                 // ничего своего — всё из default
    const style = font.get('plain');
    eq(style.size, 18, 'plain не задавал size — взял из default');
    eq(style.color, '#123456');
    eq(style.lineHeight, 2);
    eq(font.get('default').size, 18);
    eq(font.get('hud').size, 20, 'явное поле стиля сильнее default');
    font.remove('default');
    eq(font.get('plain').size, FONT_DEFAULTS.size, 'без default вернулось встроенное значение');
});

test('неизвестная база не ломает стиль, но попадает в лог один раз', () => {
    reset();
    font.define('broken', { base: 'нет-такой', size: 22 });
    eq(font.get('broken').size, 22);
    eq(font.get('broken').color, FONT_DEFAULTS.color);
    eq(logs.length, 1);
    truthy(logs[0].includes('нет-такой'));
    font.get('broken');           // второй resolve молчит
    eq(logs.length, 1);
});

test('циклическое наследование не вешает разбор', () => {
    font.define('a', { base: 'b', size: 11 });
    font.define('b', { base: 'a', color: '#abcdef' });
    const style = font.get('a');
    eq(style.size, 11);
    eq(style.color, '#abcdef');
});

// --- Применение к узлам ----------------------------------------------------

test('apply ставит размер и выравнивание узлу-обёртке', () => {
    reset();
    font.define('hud', { size: 20, color: '#ffffff', align: 'left' });
    const label = $('<ui.label>', { id: 'score' });
    font.apply(label, 'hud');
    const n = label.get(0);
    eq(n.size, 20);
    eq(n.attrs.align, 'left');
    eq(n.color, packColor('#ffffff'));
    eq(font.of(label), 'hud');
});

test('apply у кнопки перекрашивает подпись, а не фон', () => {
    reset();
    const button = $('<ui.button>', { id: 'play', color: '#22304a' });
    const before = button.get(0).color;
    font.define('menu', { size: 24, color: '#ffd166' });
    font.apply(button, 'menu');
    const n = button.get(0);
    eq(n.text_color, packColor('#ffd166'));
    eq(n.color, before, 'фон кнопки не изменился');
    eq(n.size, 24);
});

test('apply принимает селектор и сам узел', () => {
    reset();
    font.define('hud', { size: 20, color: '#ffffff' });
    node('ui.label', { id: 'one' });
    node('ui.label', { id: 'two' });
    font.apply('#one', 'hud');
    font.apply(query('#two')[0], 'hud');
    eq(ctx.byId.get('one').size, 20);
    eq(ctx.byId.get('two').size, 20);
});

test('неизвестный стиль: предупреждение, узел не меняется', () => {
    reset();
    const label = $('<ui.label>', { id: 'score', size: 33 });
    font.apply(label, 'нет-такого');
    eq(label.get(0).size, 33);
    eq(label.get(0).attrs._font, undefined);
    eq(logs.length, 1);
    truthy(logs[0].includes('нет-такого'));
});

test('прочие поля стиля уезжают в attrs узла', () => {
    reset();
    font.define('glow', { size: 20, letterSpacing: 3, glow: '#ff0000' });
    const label = $('<ui.label>', {});
    font.apply(label, 'glow');
    eq(label.get(0).attrs.letterSpacing, 3);
    eq(label.get(0).attrs.glow, '#ff0000');
});

// --- Метод узла и измерение ------------------------------------------------

test('.textStyle() применяет стиль, читает имя и берёт разовый набор', () => {
    reset();
    font.define('hud', { size: 20, color: '#ffffff' });
    const label = $('<text>', { id: 't', text: 'Счёт' });
    label.textStyle('hud');
    eq(label.get(0).size, 20);
    eq(label.textStyle(), 'hud');
    label.textStyle({ size: 42, color: '#00ffff' });
    eq(label.get(0).size, 42);
    eq(label.get(0).color, packColor('#00ffff'));
    eq(label.textStyle(), null, 'разовый набор не регистрирует имя');
    label.textStyle('нет-такого');
    eq(label.get(0).size, 42, 'неизвестный стиль ничего не изменил');
});

test('font.measure считает ширину размером стиля', () => {
    eq(font.measure('abcd', 'hud'), engine.measureText('abcd', 20));
    eq(font.measure('abcd', { }), engine.measureText('abcd', FONT_DEFAULTS.size));
});

test('styleOf показывает то, что читает отрисовка', () => {
    reset();
    font.define('hud', { size: 20, color: '#ff0000', align: 'right' });
    const button = $('<ui.button>', { id: 'b' });
    font.apply(button, 'hud');
    const info = font.styleOf(button);
    eq(info.font, 'hud');
    eq(info.size, 20);
    eq(info.align, 'right');
    eq(info.color, packColor('#ff0000'));
});

finish();
