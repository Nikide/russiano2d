// ===========================================================================
// Язык сценок — разбор текста story/*.scene
//
// Порт из audm-neko (game/story/story_script.gd) на философию `$`: сценарий —
// обычный текстовый файл, одна команда на строку, читается и правится в любом
// редакторе (в том числе нейросетью), а разбор и исполнение разделены.
// Разбор здесь, исполнение — `$.story` (src/highlevel/story.js).
//
//   ~ Где-то капает вода.                 голос рассказчика, без имени
//   Некотян: Ты очнулся?                  реплика (ждёт нажатия)
//   Некотян (радость): Живой!             с эмоцией
//   bubble Часовой: Кто здесь?            облачко над головой, не ждёт
//   - Кто ты? -> who                      вариант ответа
//   - Молчать {silent = 1} -> end         вариант с флагом
//   :who                                  метка
//   set trust += 1                        флаги: =, +=, -=
//   if trust >= 2 -> friend               условие: flag, !flag, ==, !=, >, <, >=, <=
//   goto finale / end
//   camera Часовой 0.6                    камера к актёру за 0.6 с
//   move Некотян CampFire                 идти к цели и ждать
//   face Часовой left|right|Игрок
//   anim Часовой clip [speed]
//   ai Часовой on|off
//   wait 1.5
//   image art/cg/prologue.png [0.5] / image off
//   fade out 0.5 / fade in 0.5
//   sound sfx/step.wav
//   objective Дойди до выхода
//   @free                                 не отбирать управление (иначе катсцена)
//
// Чистые функции (parseStory/checkCondition/applySet) не касаются движка —
// поэтому их целиком проверяет юнит-тест (tests/js/story_test.mjs).
// ===========================================================================

/** Индекс конца строки для сообщений об ошибках: `line` в каждой команде. */
function makeCommand(op, line) {
    return { op, line };
}

/** Число, если строка на него похожа, иначе саму строку. */
export function parseValue(text) {
    const s = String(text === undefined || text === null ? '' : text).trim();
    if (s === '') return '';
    if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
    return s;
}

/** Реплика «Имя: текст» / «Имя (эмоция): текст». */
export function parseSay(line, op) {
    const colon = line.indexOf(':');
    if (colon <= 0) return null;
    let who = line.slice(0, colon).trim();
    const text = line.slice(colon + 1).trim();
    let emotion = '';
    const open = who.indexOf('(');
    if (open > 0 && who.endsWith(')')) {
        emotion = who.slice(open + 1, who.length - 1).trim();
        who = who.slice(0, open).trim();
    }
    // Имя актёра — одно-два слова: иначе это непонятая команда, а не реплика.
    if (!who || who.split(/\s+/).filter(Boolean).length > 3) return null;
    return { op: op || 'say', who, emotion, text };
}

/** «текст {flag = 1} -> метка». */
export function parseChoice(body) {
    let text = body;
    let to = '';
    const arrow = text.lastIndexOf('->');
    if (arrow >= 0) {
        to = text.slice(arrow + 2).trim();
        text = text.slice(0, arrow).trim();
    }
    const sets = [];
    const open = text.indexOf('{');
    if (open >= 0 && text.endsWith('}')) {
        for (const part of text.slice(open + 1, text.length - 1).split(',')) {
            const st = parseSet(part.trim());
            if (st) sets.push(st);
        }
        text = text.slice(0, open).trim();
    }
    return { op: 'choice', text, to, sets };
}

/** set-команда: «flag = 1», «flag += 2», «flag». */
export function parseSet(rest) {
    for (const op of ['+=', '-=', '=']) {
        const at = rest.indexOf(op);
        if (at > 0) {
            return {
                op: 'set',
                flag: rest.slice(0, at).trim(),
                mode: op,
                value: parseValue(rest.slice(at + op.length)),
            };
        }
    }
    const flag = rest.trim();
    if (!flag) return null;
    return { op: 'set', flag, mode: '=', value: 1 };
}

function parseLine(line) {
    if (line.startsWith('- ')) return parseChoice(line.slice(2));
    if (line.startsWith('~')) {
        return { op: 'say', who: '', emotion: '', text: line.slice(1).trim() };
    }
    const sp = line.indexOf(' ');
    const word = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    const args = rest.split(/\s+/).filter(Boolean);

    switch (word) {
        case 'bubble': {
            const say = parseSay(rest, 'bubble');
            return say;
        }
        case 'set': return parseSet(rest);
        case 'if': {
            const arrow = rest.indexOf('->');
            if (arrow < 0) return null;
            return { op: 'if', cond: rest.slice(0, arrow).trim(), to: rest.slice(arrow + 2).trim() };
        }
        case 'goto': return { op: 'goto', to: rest };
        case 'end': return { op: 'end' };
        case 'wait': return { op: 'wait', sec: rest ? Number(parseValue(rest)) || 0 : 1.0 };
        case 'camera':
            return { op: 'camera', target: args[0] || 'player',
                     sec: args.length > 1 ? Number(parseValue(args[1])) || 0 : 0.6 };
        case 'move':
            if (args.length < 2) return null;
            return { op: 'move', actor: args[0], to: args[1], run: args[2] === 'run' };
        case 'face':
            if (args.length < 2) return null;
            return { op: 'face', actor: args[0], to: args[1] };
        case 'anim':
            if (args.length < 2) return null;
            return { op: 'anim', actor: args[0], clip: args[1],
                     speed: args.length > 2 ? Number(parseValue(args[2])) || 1 : 1.0 };
        case 'ai':
            if (args.length < 2) return null;
            return { op: 'ai', actor: args[0], on: args[1] !== 'off' };
        case 'image':
            return { op: 'image', path: args[0] || 'off',
                     sec: args.length > 1 ? Number(parseValue(args[1])) || 0 : 0.4 };
        case 'fade':
            return { op: 'fade', out: args[0] === 'out',
                     sec: args.length > 1 ? Number(parseValue(args[1])) || 0 : 0.5 };
        case 'sound': return { op: 'sound', path: rest };
        case 'objective': return { op: 'objective', text: rest };
        default: return parseSay(line);
    }
}

/**
 * Разобрать текст сценки.
 *
 * Возвращает `{ commands, labels, free, errors }`. `free` — заголовок `@free`:
 * сценка не отбирает управление у игрока (иначе это катсцена).
 */
export function parseStory(text) {
    const commands = [];
    const labels = {};
    const errors = [];
    let free = false;
    let n = 0;

    for (const raw of String(text === undefined || text === null ? '' : text).split('\n')) {
        n++;
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line === '@free') { free = true; continue; }
        if (line.startsWith(':')) { labels[line.slice(1).trim()] = commands.length; continue; }

        const cmd = parseLine(line);
        if (!cmd) { errors.push(`строка ${n}: не понял «${line}»`); continue; }
        cmd.line = n;
        // Варианты ответа приклеиваются к ближайшему блоку выборов.
        if (cmd.op === 'choice') {
            if (commands.length === 0 || commands[commands.length - 1].op !== 'choices') {
                commands.push({ op: 'choices', items: [], line: n });
            }
            commands[commands.length - 1].items.push(cmd);
            continue;
        }
        commands.push(cmd);
    }
    return { commands, labels, free, errors };
}

/** Истинность значения флага: строка — непустая, число — не ноль. */
export function isTruthy(value) {
    if (typeof value === 'string') return value !== '';
    if (value === null || value === undefined) return false;
    return Number(value) !== 0;
}

function looseEqual(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
        return Math.abs(a - b) < 1e-6;
    }
    return String(a) === String(b);
}

/**
 * Условие по флагам: «flag», «!flag», «flag >= 2», «flag == текст».
 *
 * Приведение намеренно мягкое, как в оригинале: неизвестный флаг — 0, поэтому
 * «!visited» работает до первого `set visited = 1`.
 */
export function checkCondition(cond, flags) {
    const text = String(cond === undefined || cond === null ? '' : cond).trim();
    const store = flags || {};
    for (const op of ['>=', '<=', '!=', '==', '>', '<']) {
        const at = text.indexOf(op);
        if (at <= 0) continue;
        const a = store[text.slice(0, at).trim()];
        const b = parseValue(text.slice(at + op.length));
        const an = a === undefined ? 0 : a;
        const aNum = typeof an === 'number' ? an : Number(an);
        const bNum = typeof b === 'number' ? b : Number(b);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)
            && String(an).trim() !== '' && String(b).trim() !== '') {
            if (op === '>=') return aNum >= bNum;
            if (op === '<=') return aNum <= bNum;
            if (op === '>') return aNum > bNum;
            if (op === '<') return aNum < bNum;
            if (op === '==') return Math.abs(aNum - bNum) < 1e-6;
            if (op === '!=') return Math.abs(aNum - bNum) >= 1e-6;
        }
        if (op === '==') return looseEqual(an === undefined ? 0 : an, b);
        if (op === '!=') return !looseEqual(an === undefined ? 0 : an, b);
        return false;
    }
    if (text.startsWith('!')) return !isTruthy(store[text.slice(1).trim()]);
    return isTruthy(store[text]);
}

/**
 * Применить set-команду к флагам. Флаги — обычный объект; `+=` и `-=` считают
 * числами, а если значение не число — заменяют (как в оригинале, где сложение
 * строк выродилось бы в конкатенацию Godot).
 */
export function applySet(cmd, flags) {
    if (!cmd || cmd.op !== 'set') return flags;
    const store = flags || {};
    const value = cmd.value;
    const numeric = typeof value === 'number'
        || (typeof value === 'string' && value !== '' && Number.isFinite(Number(value)));
    if (cmd.mode === '+=') {
        store[cmd.flag] = numeric
            ? (Number(store[cmd.flag]) || 0) + Number(value)
            : value;
    } else if (cmd.mode === '-=') {
        store[cmd.flag] = numeric
            ? (Number(store[cmd.flag]) || 0) - Number(value)
            : value;
    } else {
        store[cmd.flag] = value;
    }
    return store;
}

/** Индекс команды по метке: `end` — конец, неизвестная метка — null. */
export function labelIndex(script, label) {
    if (!script) return null;
    if (label === 'end' || label === '') return null;
    const index = script.labels[label];
    return index === undefined ? null : index;
}
