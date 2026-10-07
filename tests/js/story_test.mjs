// ===========================================================================
// Юнит-тесты языка сценок (src/highlevel/story_script.js) без движка.
//
// Проверяем то, что легко сломать: разбор всех команд DSL, порядок и метки,
// приклеивание вариантов к блоку выборов, условия по флагам и set-команды.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/story_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    parseStory, parseSay, parseChoice, parseSet, parseValue,
    checkCondition, applySet, isTruthy, labelIndex,
} from '../../src/highlevel/story_script.js';

test('parseStory: заголовок @free, метки и пропуск комментариев', () => {
    const s = parseStory('@free\n# комментарий\n\n:start\nНекотян: Привет\n:next\ngoto start');
    eq(s.free, true);
    eq(s.commands.length, 2);
    eq(s.labels.start, 0);
    eq(s.labels.next, 1);
    eq(s.commands[0].op, 'say');
    eq(s.commands[0].text, 'Привет');
    eq(s.commands[0].line, 5, 'номер строки для сообщений');
    eq(s.errors.length, 0);
});

test('parseStory: неизвестная строка попадает в errors, разбор продолжается', () => {
    const s = parseStory(':a\nкакая-то ерунда без двоеточия\nend');
    eq(s.commands.length, 1);
    eq(s.commands[0].op, 'end');
    eq(s.errors.length, 1);
    truthy(s.errors[0].includes('ерунда'), 'в ошибке есть сама строка');
});

test('parseSay: имя, эмоция и рассказчик', () => {
    const a = parseSay('Некотян: Ты очнулся?');
    eq(a.who, 'Некотян');
    eq(a.text, 'Ты очнулся?');
    eq(a.emotion, '');
    const b = parseSay('Некотян (радость): Живой!');
    eq(b.who, 'Некотян');
    eq(b.emotion, 'радость');
    eq(b.text, 'Живой!');
    eq(parseSay('без двоеточия'), null);
    eq(parseSay(': без имени'), null, 'пустое имя не реплика');
    eq(parseSay('слишком много слов в имени: текст'), null);
});

test('parseStory: рассказчик через ~', () => {
    const s = parseStory('~ Где-то капает вода.');
    eq(s.commands[0].op, 'say');
    eq(s.commands[0].who, '');
    eq(s.commands[0].text, 'Где-то капает вода.');
});

test('parseStory: варианты приклеиваются к одному блоку выборов', () => {
    const s = parseStory(`Некотян: Кто ты?
- Друг -> friend
- Молчать {silent = 1} -> end
:friend
end`);
    eq(s.commands.length, 3);
    eq(s.commands[1].op, 'choices');
    eq(s.commands[1].items.length, 2);
    eq(s.commands[1].items[0].text, 'Друг');
    eq(s.commands[1].items[0].to, 'friend');
    eq(s.commands[1].items[1].sets.length, 1);
    eq(s.commands[1].items[1].sets[0].flag, 'silent');
    eq(s.labels.friend, 2);
});

test('parseChoice: вариант без метки и с несколькими флагами', () => {
    const a = parseChoice('Просто ответ');
    eq(a.text, 'Просто ответ');
    eq(a.to, '');
    eq(a.sets.length, 0);
    const b = parseChoice('Ответ {a = 1, b += 2} -> x');
    eq(b.to, 'x');
    eq(b.sets.length, 2);
    eq(b.sets[0].mode, '=');
    eq(b.sets[1].mode, '+=');
    eq(b.sets[1].value, 2);
});

test('parseSet: =, +=, -= и «просто флаг»', () => {
    eq(parseSet('trust += 1').flag, 'trust');
    eq(parseSet('trust += 1').mode, '+=');
    eq(parseSet('trust += 1').value, 1);
    eq(parseSet('hp -= 2.5').value, 2.5);
    eq(parseSet('name = Некотян').value, 'Некотян');
    eq(parseSet('visited').mode, '=');
    eq(parseSet('visited').value, 1);
    eq(parseSet(''), null);
});

test('parseValue: числа и текст', () => {
    eq(parseValue('42'), 42);
    eq(parseValue('-3'), -3);
    eq(parseValue('2.5'), 2.5);
    eq(parseValue('.5'), 0.5);
    eq(parseValue('Некотян'), 'Некотян');
    eq(parseValue('42abc'), '42abc');
    eq(parseValue(''), '');
});

test('parseStory: команды постановки разбираются с аргументами', () => {
    const s = parseStory([
        'camera Часовой 0.8',
        'move Некотян CampFire run',
        'face Часовой left',
        'anim Часовой taunt 1.5',
        'ai Часовой off',
        'wait 2',
        'image art/cg/p.png 0.5',
        'image off',
        'fade out 0.5',
        'sound sfx/step.wav',
        'objective Дойди до выхода',
        'bubble Часовой: Кто здесь?',
    ].join('\n'));
    eq(s.commands.length, 12);
    eq(s.errors.length, 0);
    eq(s.commands[0].target, 'Часовой');
    near(s.commands[0].sec, 0.8, 1e-9);
    eq(s.commands[1].actor, 'Некотян');
    eq(s.commands[1].to, 'CampFire');
    eq(s.commands[1].run, true);
    eq(s.commands[2].to, 'left');
    eq(s.commands[3].clip, 'taunt');
    near(s.commands[3].speed, 1.5, 1e-9);
    eq(s.commands[4].on, false);
    near(s.commands[5].sec, 2, 1e-9);
    eq(s.commands[6].path, 'art/cg/p.png');
    eq(s.commands[7].path, 'off');
    eq(s.commands[8].out, true);
    eq(s.commands[9].path, 'sfx/step.wav');
    eq(s.commands[10].text, 'Дойди до выхода');
    eq(s.commands[11].op, 'bubble');
    eq(s.commands[11].who, 'Часовой');
});

test('parseStory: команда с нехваткой аргументов — ошибка, а не мусор', () => {
    const s = parseStory('move ТолькоАктёр\nface Один\nanim Один\nai Один');
    eq(s.commands.length, 0);
    eq(s.errors.length, 4);
});

test('checkCondition: флаги, отрицание и сравнения', () => {
    const flags = { trust: 3, name: 'Некотян', silent: 0 };
    truthy(checkCondition('trust', flags));
    truthy(checkCondition('trust >= 2', flags));
    truthy(checkCondition('trust <= 3', flags));
    truthy(checkCondition('trust > 2', flags));
    falsy(checkCondition('trust < 3', flags));
    truthy(checkCondition('trust == 3', flags));
    truthy(checkCondition('trust != 2', flags));
    truthy(checkCondition('name == Некотян', flags));
    truthy(checkCondition('name != Часовой', flags));
    truthy(checkCondition('!silent', flags), 'ноль — ложь, значит !silent истина');
    truths: {
        truthy(checkCondition('!никогда', flags), 'неизвестный флаг — тоже ложь');
    }
    falsy(checkCondition('silent', flags));
});

test('checkCondition: сравнение числа со строкой даёт false, а не исключение', () => {
    const flags = { name: 'abc' };
    falsy(checkCondition('name > 5', flags));
    truthy(checkCondition('name == abc', flags));
});

test('isTruthy: строка — непустая, число — не ноль', () => {
    truthy(isTruthy('да'));
    falsy(isTruthy(''));
    truthy(isTruthy(1));
    falsy(isTruthy(0));
    falsy(isTruthy(null));
    falsy(isTruthy(undefined));
});

test('applySet: присваивание, сложение и вычитание', () => {
    const flags = {};
    applySet(parseSet('trust = 2'), flags);
    eq(flags.trust, 2);
    applySet(parseSet('trust += 3'), flags);
    eq(flags.trust, 5);
    applySet(parseSet('trust -= 1'), flags);
    eq(flags.trust, 4);
    applySet(parseSet('name = Некотян'), flags);
    eq(flags.name, 'Некотян');
    applySet(parseSet('trust += 0.5'), flags);
    eq(flags.trust, 4.5);
});

test('applySet: сложение с нечисловым значением заменяет, а не склеивает', () => {
    const flags = { name: 'Некотян' };
    applySet(parseSet('name += Часовой'), flags);
    eq(flags.name, 'Часовой');
});

test('labelIndex: метка, end и неизвестная метка', () => {
    const s = parseStory(':start\nwait 1\n:end_label\nend');
    eq(labelIndex(s, 'start'), 0);
    eq(labelIndex(s, 'end_label'), 1);
    eq(labelIndex(s, 'end'), null, 'end — всегда конец сценки');
    eq(labelIndex(s, 'нет-такой'), null);
    eq(labelIndex(s, ''), null);
});

test('parseStory: сценка с @free и полным циклом играется по меткам', () => {
    const s = parseStory(`@free
:start
set count += 1
if count < 3 -> start
end`);
    eq(s.free, true);
    const flags = {};
    let index = 0;
    let guard = 0;
    while (index !== null && guard++ < 20) {
        const cmd = s.commands[index];
        if (cmd.op === 'set') { applySet(cmd, flags); index++; }
        else if (cmd.op === 'if') {
            index = checkCondition(cmd.cond, flags) ? labelIndex(s, cmd.to) : index + 1;
        } else if (cmd.op === 'end') index = null;
        else index++;
    }
    eq(flags.count, 3, 'цикл прошёл трижды');
});

finish();
