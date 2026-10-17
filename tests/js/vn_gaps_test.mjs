// ===========================================================================
// VN DoD gaps (roadmap 33-40): real voice playback through $.sound, dictionary
// i18n lookup, dynamic choice slots/custom templates, hard input lock, actual
// prefetch calls, Narrative inspector facts.
//
// Runs under qjs with recording backends, so every side effect is observable
// without a window/GPU. No gameplay engine is booted here.
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query, def } from '../../src/highlevel/core.js';
import { installDialog, tickDialog } from '../../src/highlevel/dialog.js';
import {
    DialogThemes, DEFAULT_RML, DEFAULT_RCSS, prepareMarkup, expandChoiceSlots,
} from '../../src/highlevel/dialog_theme.js';
import { createDialogView } from '../../src/highlevel/dialog_view.js';
import { installInput } from '../../src/highlevel/input.js';
import { createApi } from '../../src/highlevel/api.js';

ctx.$ = { _dispatchGlobal() {} };

def('at', function (x, y) { return this.eachNode((_, el) => { el.x = Number(x) || 0; el.y = Number(y) || 0; }); });
def('visible', function (flag) { return this.eachNode((_, el) => { el.visible = flag !== false; }); });
def('alpha', function (value) { return this.eachNode((_, el) => { el.alpha = Number(value); }); });
def('appendTo', function () { return this; });
def('text', function (value) { return this.eachNode((_, el) => { el.text = String(value); }); });
def('clear', function () { return this; });
def('sprite', function (value) { return this.eachNode((_, el) => { el.sprite = value; }); });
def('attr', function (name, value) {
    if (value === undefined) { const first = this.nodes[0]; return first ? first.attrs[name] : undefined; }
    return this.eachNode((_, el) => { el.attrs[name] = value; });
});
def('remove', function () { return this; });

function fakeBackend() {
    const calls = [];
    const docs = new Map();
    let next = 1;
    return {
        calls,
        docs,
        loadMarkup(name, markup) {
            const id = next++;
            docs.set(id, { name, markup });
            calls.push(['load', name, markup]);
            return id;
        },
        unload(id) { docs.delete(id); calls.push(['unload', id]); },
        show(id) { calls.push(['show', id]); },
        hide(id) { calls.push(['hide', id]); },
        setText(doc, el, text) { calls.push(['text', el, text]); },
        setClass(doc, el, cls, add) { calls.push(['class', el, cls, !!add]); },
        setAttr(doc, el, key, value) { calls.push(['attr', el, key, value]); },
        setProperty(doc, el, key, value) { calls.push(['property', el, key, value]); },
        on(doc, el, event, fn) { calls.push(['on', el, event]); return 1; },
        lastMarkup() { return [...docs.values()].pop(); },
    };
}

function makeDollar(backend, extras) {
    const e = extras || {};
    const keyState = e.keys || {};
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = { blur() {} };
    $.gfx = { size: () => ({ w: 800, h: 600 }) };
    $.i18n = e.i18n || { has: () => false, tr: (k) => String(k) };
    $.store = { get: (k, d) => (k in keyState ? keyState[k] : d), set: (k, v) => { keyState[k] = v; return $.store; } };
    const updates = [];
    $.update = (fn) => { updates.push(fn); return () => {}; };
    $.updates = updates;
    const locks = [];
    $.input = e.input || {
        pressed: (name) => !!keyState['key:' + name],
        down: () => false,
        mouse: () => ({ x: -999, y: -999 }),
        lock(name, owner, options) {
            const token = {
                name, owner: owner === undefined ? null : owner,
                hard: !!(options && options.hard), released: false,
                release() { this.released = true; locks.splice(locks.indexOf(this), 1); return true; },
            };
            locks.push(token);
            return token;
        },
        hardLocked() { return locks.some((t) => t.hard); },
        locked(name) { return name === undefined ? locks.length > 0 : locks.some((t) => t.name === name); },
        lockCount() { return locks.length; },
        rawPressed: (name) => !!keyState['key:' + name],
    };
    $.locks = locks;
    $.sound = e.sound;
    $.resource = e.resource;
    return $;
}

const CHOICE_RML = `<rml><head><title>slots</title></head><body>`
    + `<div data-dialog-role="root"><div data-dialog-role="text"></div>`
    + `<div data-dialog-role="choices"></div></div></body></rml>`;

// --- dynamic choice slots / custom templates --------------------------------

test('choices: expandChoiceSlots generates arbitrary slots with {index}/{n}', () => {
    const template = '<button data-dialog-role="choice"><span data-dialog-role="choice-text">{n}</span></button>';
    const expanded = expandChoiceSlots(CHOICE_RML, { slots: 10, template });
    const prepared = prepareMarkup(expanded);
    truthy(prepared.ok, 'expanded markup is valid');
    eq(prepared.roles.choice.length, 10, 'ten choice elements after expansion');
    eq(prepared.roles['choice-text'].length, 10, 'ten choice-text roles after expansion');
    truthy(expanded.includes('>1</span>') && expanded.includes('>10</span>'), 'index/n placeholders substituted');
    truthy(prepared.markup.includes('id="r2d-dlg-choice-9"'), 'last generated choice gets a unique id');
});

test('choices: authored first item is cloned when no template is given', () => {
    const rml = `<rml><body><div data-dialog-role="root"><div data-dialog-role="text"></div>`
        + `<div data-dialog-role="choices"><button data-dialog-role="choice" id="authored">A</button></div>`
        + `</div></body></rml>`;
    const expanded = expandChoiceSlots(rml, { slots: 4 });
    const prepared = prepareMarkup(expanded);
    eq(prepared.roles.choice.length, 4, 'cloned from first authored choice');
    eq((expanded.match(/id="authored"/g) || []).length, 0, 'authored id stripped from clones');
    truthy(expanded.includes('>A</button>'), 'cloned content preserved');
});

test('choices: theme choiceSlots + custom template reach the RML document', () => {
    const backend = fakeBackend();
    const themes = new DialogThemes();
    truthy(themes.define('slots', {
        rml: CHOICE_RML, rcss: 'body{}', choiceSlots: 12,
        choiceTemplate: '<button data-dialog-role="choice"><span data-dialog-role="choice-text">{index}</span></button>',
    }), 'theme with choice slots defined');
    const view = createDialogView({ backend, themes });
    truthy(view.load('slots'), 'theme loads');
    eq(view.choiceSlots, 12, 'view reports twelve slots');
    eq(view.roles.choice.length, 12, 'twelve choice bindings');
    view.setChoices(Array.from({ length: 12 }, (_, i) => ({ text: 'ch' + i, focused: i === 11 })));
    const text = backend.calls.filter((c) => c[0] === 'text' && c[1] === 'r2d-dlg-choice-11');
    truthy(text.some((c) => c[2] === 'ch11'), 'twelfth dynamic choice receives text');
    eq((view.roles['choice-text'] || []).length, 12, 'custom template keeps choice-text roles');
});

test('choices: invalid slot counts are rejected by the theme registry', () => {
    const themes = new DialogThemes();
    falsy(themes.define('bad0', { rml: DEFAULT_RML, choiceSlots: 0 }), 'zero slots rejected');
    falsy(themes.define('bad65', { rml: DEFAULT_RML, choiceSlots: 65 }), '65 slots rejected');
    falsy(themes.define('badfrac', { rml: DEFAULT_RML, choiceSlots: 2.5 }), 'fractional slots rejected');
    truthy(themes.define('ok', { rml: DEFAULT_RML, choiceSlots: 8 }), '8 slots accepted');
});

// --- real voice playback ----------------------------------------------------

test('voice: plays through $.sound, stops previous and on close', () => {
    const backend = fakeBackend();
    const played = [], stopped = [];
    let channel = 0;
    const sound = {
        preload(paths) { played.push(['preload', [].concat(paths)]); return sound; },
        play(path, opts) { played.push(['play', path, opts.volume]); return channel++; },
        stop(handle, fade) { stopped.push([handle, fade]); },
    };
    const $ = makeDollar(backend, { sound });
    const dialog = installDialog($, { backend });
    dialog.speaker('w', { name: 'W', voice: 'voice/w/01.ogg' });
    dialog.define('v', {
        start: 'a',
        nodes: {
            a: { speaker: 'w', text: 'one', to: 'b' },
            b: { speaker: 'w', text: 'two', to: 'c' },
            c: { speaker: 'w', text: 'three' },
        },
    });
    truthy(dialog.play('v'), 'dialog opens');
    truthy(played.some((p) => p[0] === 'play' && p[1] === 'voice/w/01.ogg'), 'voice auto-plays through $.sound');
    truthy(dialog.voiceInfo().playing, 'voice is reported as playing');
    eq(dialog.voiceInfo().src, 'voice/w/01.ogg', 'voice source tracked');
    dialog.skip();
    dialog.next();
    const lastPlay = played.filter((p) => p[0] === 'play');
    eq(lastPlay.length, 2, 'next line starts a new voice');
    truthy(stopped.length >= 1, 'previous voice stopped before the next line');
    dialog.close();
    truthy(stopped.length >= 2, 'voice stopped on close');
    falsy(dialog.voiceInfo().playing, 'nothing plays after close');

    dialog.voice(false);
    truthy(dialog.play('v'), 'reopen with voice disabled');
    eq(played.filter((p) => p[0] === 'play').length, 2, 'voice disabled suppresses playback');
    dialog.close();
});

test('voice: per-line voice wins over speaker voice', () => {
    const backend = fakeBackend();
    const played = [];
    const sound = { play(path) { played.push(path); return 0; }, stop() {}, preload() {} };
    const $ = makeDollar(backend, { sound });
    const dialog = installDialog($, { backend });
    dialog.speaker('w', { name: 'W', voice: 'speaker.ogg' });
    dialog.define('v2', { start: 'a', nodes: { a: { speaker: 'w', voice: 'line.ogg', text: 'x' } } });
    truthy(dialog.play('v2'), 'line dialog opens');
    eq(played[played.length - 1], 'line.ogg', 'line voice overrides speaker voice');
    dialog.close();
});

// --- actual prefetch --------------------------------------------------------

test('prefetch: portrait textures and voice go to $.resource/$.sound caches', () => {
    const backend = fakeBackend();
    const textureCalls = [], soundPreloads = [];
    const resource = {
        preloadTexture(path) {
            textureCalls.push(path);
            if (path === 'art/w/smirk.png') return { loaded: 1, failed: 0, failedPaths: [] };
            return { loaded: 0, failed: 1, failedPaths: [path] };
        },
    };
    const sound = { preload(paths) { soundPreloads.push([].concat(paths)); }, play() { return 0; }, stop() {} };
    const $ = makeDollar(backend, { resource, sound });
    const dialog = installDialog($, { backend });
    dialog.speaker('w', { name: 'W', portraits: { neutral: 'art/w/neutral.png', smirk: 'art/w/smirk.png' }, voice: 'voice/w/01.ogg' });
    dialog.define('p', { start: 'a', nodes: { a: { speaker: 'w', expression: 'smirk', text: 'hi' } } });
    truthy(dialog.play('p'), 'dialog opens');
    truthy(textureCalls.includes('art/w/smirk.png'), 'smirk portrait actually preloaded');
    truthy(textureCalls.includes('art/w/neutral.png'), 'neutral portrait actually preloaded');
    truthy(soundPreloads.some((list) => list.includes('voice/w/01.ogg')), 'voice actually preloaded');
    const info = dialog.prefetchInfo();
    truthy(info && info.requested >= 3, 'prefetch report counts requested assets');
    truthy(info.textures >= 1, 'prefetch report counts loaded textures');
    truthy(info.sounds >= 1, 'prefetch report counts preloaded sounds');

    dialog.prefetch(['art/w/missing.png']);
    const after = dialog.prefetchInfo();
    truthy(after.failed.includes('art/w/missing.png'), 'failed texture is reported, not swallowed');
    dialog.close();
});

// --- i18n dictionary lookup -------------------------------------------------

test('i18n: dialog renders dictionary values, not just key presence', () => {
    const dictionary = {
        'npc.greet': 'Здравствуй, {name}!',
        'npc.name': 'Некотян',
        'choice.leave': 'Уйти',
    };
    const i18n = {
        lookup(key) { return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined; },
        has(key) { return Object.prototype.hasOwnProperty.call(dictionary, key); },
        tr(key, params) {
            const value = dictionary[key];
            if (Array.isArray(value)) return value[0];
            return String(value).replace(/\{(\w+)\}/g, (_, k) => (params && params[k] !== undefined ? params[k] : ''));
        },
        lang() { return 'ru'; },
    };
    const backend = fakeBackend();
    const $ = makeDollar(backend, { i18n });
    const dialog = installDialog($, { backend });
    dialog.define('i18n', {
        start: 'a',
        nodes: { a: { speaker: 'npc.name', text: 'npc.greet', choices: [{ text: 'choice.leave' }] } },
    });
    dialog.vars({ name: 'Мир' });
    truthy(dialog.play('i18n'), 'dialog opens');
    eq(dialog.fullText(), 'Здравствуй, Мир!', 'dictionary value rendered with vars');
    eq(dialog.speaker(), 'Некотян', 'speaker dictionary value rendered');
    eq(dialog.choices()[0].text, 'Уйти', 'choice dictionary value rendered');
    truthy(dialog.i18nStats().translated.includes('npc.greet'), 'translated key tracked');
    eq(dialog.localize('npc.greet', { name: 'X' }), 'Здравствуй, X!', 'localize() looks up the dictionary');
    eq(dialog.localize('npc.missing'), 'npc.missing', 'missing dictionary key falls back to the key');
    dialog.close();
});

test('i18n: missing dotted keys are reported, plain literals are not', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend, { i18n: { has: () => false, tr: (k) => k, lookup: () => undefined, lang: () => 'ru' } });
    const dialog = installDialog($, { backend });
    dialog.define('m', { start: 'a', nodes: { a: { text: 'npc.not_in_dict' } } });
    truthy(dialog.play('m'), 'dialog opens');
    eq(dialog.fullText(), 'npc.not_in_dict', 'missing key stays visible');
    truthy(dialog.i18nStats().missing.includes('npc.not_in_dict'), 'dotted missing key tracked');
    dialog.close();

    dialog.define('m2', { start: 'a', nodes: { a: { text: 'Просто реплика' } } });
    truthy(dialog.play('m2'), 'literal dialog opens');
    falsy(dialog.i18nStats().missing.includes('Просто реплика'), 'plain literal is not a missing i18n key');
    dialog.close();
});

// --- hard input lock --------------------------------------------------------

test('input: hard lock suppresses gameplay keys but not raw/UI reads', () => {
    const key = { down: true, pressed: true, released: true };
    const $ = { trace: () => null };
    const old = {
        keyDown: engine.keyDown, keyPressed: engine.keyPressed, keyReleased: engine.keyReleased,
        scancode: engine.scancode,
    };
    engine.scancode = (name) => (String(name).toLowerCase() === 'space' ? 44 : 0);
    const input = installInput($);
    engine.keyDown = () => key.down;
    engine.keyPressed = () => key.pressed;
    engine.keyReleased = () => key.released;
    try {
        truthy(input.pressed('space'), 'advisory scene sees keys');
        const hard = input.lock('dialog', 'dialog', { hard: true });
        truthy(hard.hard, 'token is hard');
        truthy(input.hardLocked(), 'hard lock is active');
        falsy(input.pressed('space'), 'hard lock hides pressed');
        falsy(input.down('space'), 'hard lock hides down');
        falsy(input.released('space'), 'hard lock hides released');
        truthy(input.rawPressed('space'), 'raw path still sees pressed for the lock owner');
        eq(input.hardLocks()[0], 'dialog', 'hard lock name listed');
        hard.release();
        truthy(input.pressed('space'), 'release restores gameplay input');
        const advisory = input.lock('cutscene');
        falsy(input.hardLocked(), 'advisory token is not hard');
        truthy(input.pressed('space'), 'advisory token does not gate input');
        advisory.release();
    } finally {
        engine.keyDown = old.keyDown;
        engine.keyPressed = old.keyPressed;
        engine.keyReleased = old.keyReleased;
        engine.scancode = old.scancode;
    }
});

test('dialog: hardLock option passes a hard token and can be toggled', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    dialog.define('l', { start: 'a', nodes: { a: { text: 'x' } } });
    truthy(dialog.hardLock(true), 'hard lock enabled');
    truthy(dialog.play('l'), 'dialog opens');
    truthy($.locks[0].hard, 'dialog acquired a hard token');
    truthy(dialog.inspect().inputHardLocked, 'inspector sees hard lock');
    dialog.hardLock(false);
    falsy($.locks[0].hard, 'toggling replaces the token with an advisory one');
    falsy(dialog.inspect().inputHardLocked, 'inspector sees advisory lock');
    truthy(dialog.play('l'), 'dialog restarts under advisory lock');
    dialog.close();
    eq($.input.lockCount(), 0, 'all locks released on close');
});

// --- narrative inspector facts ---------------------------------------------

test('inspector: narrative panel exposes dialog/voice/prefetch/i18n facts', () => {
    const backend = fakeBackend();
    const sound = { play() { return 0; }, stop() {}, preload() {} };
    const $ = makeDollar(backend, { sound });
    const dialog = installDialog($, { backend });
    dialog.define('n', { start: 'a', nodes: { a: { speaker: 'w', text: 'hi', choices: [{ text: 'ok' }] } } });
    truthy(dialog.play('n'), 'dialog opens');
    const snap = dialog.inspect();
    eq(snap.open, true, 'inspector open');
    truthy(snap.voice && snap.voice.enabled, 'inspector voice facts');
    truthy(snap.i18n && Array.isArray(snap.i18n.missing), 'inspector i18n facts');
    eq(typeof snap.choiceSlots, 'number', 'inspector choice slot count');
    dialog.close();
});

test('devtools: narrative section is available without a selected entity', () => {
    const $ = createApi();
    const d = $.devtools;
    truthy(d && typeof d.narrative === 'function', '$.devtools.narrative exists');
    const snap = d.narrative();
    truthy(snap.section && typeof snap.section.html === 'string', 'narrative section has html');
    truthy(snap.section.text.includes('open') || snap.section.text.length > 0, 'narrative section has facts');
});

finish();
