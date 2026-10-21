// ===========================================================================
// Формат `*.input.json` (Input Tools): действия и раскладка `$.input`.
//
//   const f = $.fs.readJSON('controls.input.json');
//   for (const a of Object.keys(f.actions)) $.input.bind(a, f.actions[a]);
//   if (f.deadzone !== undefined) $.input.deadzone(f.deadzone);
//
// См. docs/highlevel/input.md. Имена клавиш — «человеческие» ('space', 'w',
// 'left', 'gamepad.a'). Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, inRange, err, warn, checkRoot } from '../kit.js';

export const ID = 'input';
export const SUFFIX = '.input.json';
export const PREFIX = 'SDK_INPUT';
const ACTION_RE = /^[A-Za-z0-9_\-]{1,48}$/;
const NAMED = ['space', 'enter', 'return', 'escape', 'tab', 'backspace', 'left', 'right', 'up', 'down', 'leftshift', 'rightshift',
    'leftctrl', 'rightctrl', 'leftalt', 'rightalt', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'capslock',
    'mouse.left', 'mouse.middle', 'mouse.right',
    // псевдонимы $.input (src/highlevel/input.js ALIASES)
    'spacebar', 'esc', 'lshift', 'rshift', 'shift', 'lctrl', 'rctrl', 'ctrl', 'lalt', 'ralt', 'alt', 'cmd', 'win', 'meta', 'minus', 'plus', 'equals', 'comma', 'period', 'slash', 'backslash', 'semicolon', 'quote'];

export function create() {
    return {
        version: 1,
        deadzone: 0.2,
        actions: {
            jump: ['space', 'w', 'gamepad.a'],
            left: ['a', 'left', 'gamepad.dpleft'],
            right: ['d', 'right', 'gamepad.dpright'],
            fire: ['mouse.left', 'gamepad.x'],
        },
    };
}

export function keyKnown(key) {
    const k = String(key).toLowerCase();
    if (/^[a-z0-9]$/.test(k) || /^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return true;
    if (NAMED.indexOf(k) >= 0) return true;
    return /^gamepad\.[a-z0-9]+$/.test(k);
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    if (root.deadzone !== undefined && !inRange(root.deadzone, 0, 1)) out.push(err(PREFIX + '_DEADZONE', 'deadzone — число 0..1', { field: 'deadzone' }));
    if (!isObj(root.actions) || Object.keys(root.actions).length > 128) {
        out.push(err(PREFIX + '_ACTIONS', 'actions — объект «действие → клавиши» (до 128)', { field: 'actions' }));
        return out;
    }
    const owner = new Map();
    for (const name of Object.keys(root.actions)) {
        const keys = root.actions[name];
        const loc = { action: name };
        if (!ACTION_RE.test(name)) out.push(err(PREFIX + '_ACTION', 'Имя действия «' + name + '»: латиница, цифры, «_», «-»', loc));
        if (!Array.isArray(keys) || keys.length < 1 || keys.length > 16 || !keys.every((k) => isStr(k) && k)) {
            out.push(err(PREFIX + '_KEYS', 'Действие «' + name + '»: массив из 1..16 непустых имён клавиш', loc));
            continue;
        }
        for (const key of keys) {
            if (!keyKnown(key)) out.push(warn(PREFIX + '_UNKNOWN_KEY', 'Действие «' + name + '»: клавиша «' + key + '» не в списке известных', { action: name, key }));
            const k = key.toLowerCase();
            if (owner.has(k) && owner.get(k) !== name) {
                out.push(warn(PREFIX + '_CONFLICT', 'Клавиша «' + key + '» привязана и к «' + owner.get(k) + '», и к «' + name + '»', { action: name, key }));
            } else {
                owner.set(k, name);
            }
        }
    }
    return out;
}

export function summary(root) {
    const a = isObj(root && root.actions) ? root.actions : {};
    return 'действий ' + Object.keys(a).length + ' · клавиш ' + Object.keys(a).reduce((n, k) => n + (Array.isArray(a[k]) ? a[k].length : 0), 0);
}
export function snippet(rel) {
    return "const f = $.fs.readJSON('" + rel + "'); for (const a of Object.keys(f.actions)) $.input.bind(a, f.actions[a]);";
}
