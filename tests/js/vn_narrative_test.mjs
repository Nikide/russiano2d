// ===========================================================================
// VN narrative: dialog logic/view split, semantic RML roles, themes, speakers,
// expressions, portrait slots, input lock, auto/skip/backlog/save, story IR.
//
// Runs under qjs without a window: the RmlUi backend is a recording fake, so
// the test proves markup/RCSS composition and the data-dialog-role contract
// (including @font-face custom fonts) without pixel rendering.
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query, def } from '../../src/highlevel/core.js';
import { installDialog, tickDialog, revealText, advanceTyping } from '../../src/highlevel/dialog.js';
import {
    DialogThemes, DEFAULT_RML, DEFAULT_RCSS, prepareMarkup, collectRoles,
    inlineRcss, validateMarkup, fontFaceRule,
} from '../../src/highlevel/dialog_theme.js';
import { createDialogView } from '../../src/highlevel/dialog_view.js';
import { installStory, compileStory } from '../../src/highlevel/story.js';
import { parseStory } from '../../src/highlevel/story_script.js';

ctx.$ = { _dispatchGlobal() {} };

// Minimal Wrapper methods that api.js would normally install. Dialogue and
// story logic must be testable without booting the whole game API.
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
    let rejectNext = false;
    return {
        calls,
        get rejects() { return rejectNext; },
        rejectNextLoad(value) { rejectNext = !!value; },
        docs,
        loadMarkup(name, markup) {
            if (rejectNext) { rejectNext = false; calls.push(['load-rejected', name]); return -1; }
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

function makeDollar(backend, keys) {
    const keyState = keys || {};
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = { blur() {} };
    $.gfx = { size: () => ({ w: 800, h: 600 }) };
    $.i18n = { has: () => false, tr: (k) => String(k) };
    $.store = { get: (k, d) => (k in keyState ? keyState[k] : d), set: (k, v) => { keyState[k] = v; return $.store; } };
    const updates = [];
    $.update = (fn) => { updates.push(fn); return () => {}; };
    $.updates = updates;
    const locks = [];
    $.input = {
        pressed: (name) => !!keyState['key:' + name],
        down: () => false,
        mouse: () => ({ x: -999, y: -999 }),
        lock(name) {
            const token = { name, released: false, release() { this.released = true; locks.splice(locks.indexOf(this), 1); return true; } };
            locks.push(token);
            return token;
        },
        locked(name) { return name === undefined ? locks.length > 0 : locks.some((t) => t.name === name); },
        lockCount() { return locks.length; },
    };
    $.locks = locks;
    return $;
}

function resetKeys(keyState) { for (const k of Object.keys(keyState)) delete keyState[k]; }

// --- dialog_theme -----------------------------------------------------------

test('theme: default RML exposes required semantic roles and injects ids', () => {
    const prepared = prepareMarkup(DEFAULT_RML);
    truthy(prepared.ok, 'default markup valid');
    truthy(prepared.roles.root && prepared.roles.text && prepared.roles.choices, 'required roles found');
    eq(prepared.roles.choice.length, 6, 'six choice buttons by role');
    truthy(prepared.markup.includes('id="r2d-dlg-root"'), 'root id is generated, not authored');
    truthy(collectRoles(prepared.markup).includes('portrait-image'), 'portrait image role collected');
});

test('theme: custom RML + RCSS + @font-face compose without hardcoded ids', () => {
    const rml = `<rml><head><title>x</title></head><body>`
        + `<div data-dialog-role="root"><div data-dialog-role="portrait"><img data-dialog-role="portrait-image"/></div>`
        + `<div data-dialog-role="box"><div data-dialog-role="speaker"></div><div data-dialog-role="text"></div></div>`
        + `<div data-dialog-role="choices"><button data-dialog-role="choice"></button><button data-dialog-role="choice"></button></div>`
        + `</div></body></rml>`;
    const rcss = `:root { --dialog-text:#fff; }\n[data-dialog-role="text"] { font-family:"Bashnya"; font-size:26px; }\n`
        + fontFaceRule('Bashnya', '../../fonts/bashnya.ttf');
    const prepared = prepareMarkup(rml);
    truthy(prepared.ok, 'custom markup valid');
    falsy(rml.includes('id="'), 'author does not need ids');
    const full = inlineRcss(prepared.markup, rcss);
    truthy(full.includes('@font-face'), 'custom font is injected via RCSS');
    truthy(full.includes('font-family:"Bashnya"'), 'font family preserved');
    truthy(validateMarkup(rml).ok, 'validator accepts custom RML');
    falsy(validateMarkup('<div data-dialog-role="root"></div>').ok, 'validator rejects missing roles/rml root');
});

test('theme: registry + stack tokens + named custom themes', () => {
    const themes = new DialogThemes();
    eq(themes.current(), 'default');
    truthy(themes.define('bashnya', { rml: DEFAULT_RML, rcss: DEFAULT_RCSS + '\nbody{}' }), 'define theme');
    truthy(themes.use('bashnya'), 'use theme');
    eq(themes.current(), 'bashnya');
    const token = themes.push('default');
    truthy(token, 'push token returned');
    eq(themes.current(), 'default');
    truthy(token.release(), 'token releases');
    eq(themes.current(), 'bashnya');
    truthy(themes.resolve('bashnya').rcss.includes('body{}'), 'custom rcss resolved');
    falsy(themes.use('missing'), 'unknown theme rejected');
});

// --- dialog_view -----------------------------------------------------------

test('view: renders text, speaker, portrait slot, choices and UI classes', () => {
    const backend = fakeBackend();
    const themes = new DialogThemes();
    const view = createDialogView({ backend, themes });
    truthy(view.load('default'), 'default theme loads');
    view.show();
    view.render({
        speakerName: '???', speakerActive: false, portrait: 'art/w/smirk.png', slot: 'far-left',
        text: 'А это что за трубка?', typing: true, choices: [{ text: 'Не знаю.', focused: true }],
        hasSpeaker: true, hasPortrait: true, hasChoices: true, auto: true,
    });
    const calls = backend.calls;
    truthy(calls.some((c) => c[0] === 'text' && c[1] === 'r2d-dlg-text' && c[2].includes('трубка')), 'text role receives live text');
    truthy(calls.some((c) => c[0] === 'text' && c[1] === 'r2d-dlg-speaker' && c[2] === '???'), 'speaker role receives name');
    truthy(calls.some((c) => c[0] === 'attr' && c[1] === 'r2d-dlg-portrait-image' && c[3] === 'art/w/smirk.png'), 'portrait image src bound');
    truthy(calls.some((c) => c[0] === 'class' && c[2] === 'slot-far-left' && c[3] === true), 'portrait slot class applied');
    truthy(calls.some((c) => c[0] === 'class' && c[2] === 'typing' && c[3] === true), 'typing root class');
    truthy(calls.some((c) => c[0] === 'class' && c[2] === 'has-choices' && c[3] === true), 'choices root class');
    truthy(calls.some((c) => c[0] === 'text' && c[1] === 'r2d-dlg-choice' && c[2] === 'Не знаю.'), 'choice text bound');
    truthy(calls.some((c) => c[0] === 'class' && c[1] === 'r2d-dlg-choice' && c[2] === 'focused' && c[3] === true), 'focused choice');
    view.hide();
    truthy(backend.calls.some((c) => c[0] === 'hide'), 'view hides');
});

test('view: hot reload keeps last valid UI when the new RML is rejected', () => {
    const backend = fakeBackend();
    const themes = new DialogThemes();
    const view = createDialogView({ backend, themes });
    truthy(view.load('default'), 'initial load');
    const first = view.document;
    backend.rejectNextLoad(true);
    falsy(view.reload(), 'invalid reload fails');
    eq(view.document, first, 'last valid document stays active');
    backend.rejectNextLoad(true);
    falsy(view.theme('default'), 'invalid theme load fails without destroying old doc');
    eq(view.document, first, 'old document still active');
});

// --- dialog logic + registry ----------------------------------------------

test('dialog: speaker registry, expression portrait and portrait slot', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    dialog.speaker('w', {
        name: '???',
        portraits: { neutral: 'art/w/neutral.png', smirk: 'art/w/smirk.png' },
        textBlip: 'sfx/blip.wav',
        voice: 'voice/w/01.ogg',
    });
    let blip = null, voice = null, prefetch = null;
    dialog.on('textBlip', (e) => { blip = e; });
    dialog.on('voice', (e) => { voice = e; });
    dialog.on('prefetch', (e) => { prefetch = e; });
    dialog.define('talk', {
        start: 'line',
        nodes: { line: { speaker: 'w', expression: 'smirk', slot: 'left', text: 'Привет.' } },
    });
    truthy(dialog.play('talk'), 'dialog opens');
    eq(dialog.speakerName(), '???', 'registry name is the display name');
    eq(dialog.speakerId(), 'w', 'internal speaker id preserved');
    eq(dialog.expression(), 'smirk', 'expression');
    eq(dialog.portrait(), 'art/w/smirk.png', 'expression selects portrait');
    eq(dialog.portraitSlot(), 'left', 'portrait slot');
    truthy(blip && blip.src === 'sfx/blip.wav', 'textBlip hook fired');
    truthy(voice && voice.src === 'voice/w/01.ogg', 'voice hook fired');
    truthy(prefetch && prefetch.assets.includes('art/w/smirk.png'), 'prefetch hook lists portraits');
    dialog.close();
});

test('dialog: themeDefine/themePush/hotReload keep state and release tokens', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    dialog.themeDefine('memory', { rml: DEFAULT_RML, rcss: DEFAULT_RCSS + '\nbody{color:#fff}' });
    dialog.define('t', { start: 'a', nodes: { a: { text: 'one', to: 'b' }, b: { text: 'two' } } });
    truthy(dialog.play('t'), 'dialog opens');
    const token = dialog.themePush('memory');
    truthy(token && dialog.theme() === 'memory', 'pushed theme active');
    const backendCalls = backend.calls.length;
    truthy(dialog.hotReload(), 'hot reload succeeds');
    truthy(backend.calls.length > backendCalls, 'reload reloads the document');
    eq(dialog.fullText(), 'one', 'hot reload preserves narrative state');
    truthy(token.release() && dialog.theme() === 'default', 'token restores previous theme');
    dialog.close();
});

test('dialog: input lock token is acquired and auto-released on close/exception', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    dialog.define('t', { start: 'a', nodes: { a: { text: 'x' } } });
    truthy(dialog.play('t'), 'open');
    truthy($.input.lockCount() === 1, 'dialog acquires one input lock');
    truthy(dialog.lockHeld(), 'lock is visible in inspector');
    dialog.close();
    eq($.input.lockCount(), 0, 'close releases the lock');
    truthy(dialog.play('t'), 'reopen');
    dialog.releaseLock('exception');
    eq($.input.lockCount(), 0, 'manual exception release');
    dialog.close();
    eq($.input.lockCount(), 0, 'close after release is safe');
});

test('dialog: auto, backlog, read/unread and save/restore', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    dialog.define('t', {
        start: 'a',
        nodes: {
            a: { speaker: 'w', text: 'one', to: 'b' },
            b: { speaker: 'w', text: 'two' },
        },
    });
    dialog.speaker('w', { name: 'W' });
    truthy(dialog.play('t'), 'open');
    dialog.skip();
    eq(dialog.backlog().length, 1, 'first line recorded');
    eq(dialog.unreadCount(), 0, 'shown line is read');
    truthy(dialog.isRead(dialog.backlog()[0].id), 'stable line id marked read');
    dialog.next();
    truthy(dialog.backlog().length >= 2, 'second line recorded');
    dialog.auto(true);
    truthy(dialog.auto(), 'auto toggled');
    truthy(dialog.backlogOpen(true), 'backlog opens');
    const saved = dialog.saveState();
    eq(saved.open, true, 'save includes open state');
    eq(saved.definition, 't', 'save includes definition');
    eq(saved.speakerId, 'w', 'save includes speaker');
    dialog.close();
    truthy(dialog.restore(saved), 'restore reopens narrative');
    truthy(dialog.isOpen(), 'restored dialog is open');
    eq(dialog.definition(), 't', 'restored definition');
    dialog.close();
});

test('dialog: keyboard and gamepad choices use the same runtime', () => {
    const backend = fakeBackend();
    const keyState = {};
    const $ = makeDollar(backend, keyState);
    const dialog = installDialog($, { backend });
    let picked = -1;
    dialog.define('c', {
        start: 'q',
        nodes: {
            q: { text: 'Choose', choices: [{ text: 'A', to: 'a' }, { text: 'B', to: 'b' }] },
            a: { text: 'A!' }, b: { text: 'B!' },
        },
    });
    dialog.on('choice', (e) => { picked = e.index; });
    truthy(dialog.play('c'), 'choice dialog opens');
    dialog.skip();
    keyState['key:down'] = true;
    tickDialog(1 / 60);
    eq(dialog.choiceFocus(), 1, 'keyboard down moves focus');
    keyState['key:down'] = false;
    keyState['key:enter'] = true;
    tickDialog(1 / 60);
    eq(picked, 1, 'keyboard enter chooses');
    resetKeys(keyState);
    dialog.close();

    truthy(dialog.play('c'), 'choice dialog reopens');
    dialog.skip();
    keyState['key:gamepad.a'] = true;
    tickDialog(1 / 60);
    eq(picked, 0, 'gamepad confirm chooses focused choice');
    resetKeys(keyState);
    dialog.close();
});

// --- story IR / shared runtime --------------------------------------------

test('story: compiles .scene into Narrative IR and keeps one dialog runtime', () => {
    const script = parseStory(`Некотян (радость): Живой!
- Друг -> friend
- Молчать {silent = 1} -> end
:friend
set trust += 1
end`);
    const ir = compileStory(script);
    eq(ir[0].op, 'say', 'say op');
    eq(ir[0].speaker, 'Некотян', 'IR speaker');
    eq(ir[0].expression, 'радость', 'IR expression');
    eq(ir[1].op, 'choice', 'choice op');
    eq(ir[1].choices.length, 2, 'IR choices');
    eq(ir[1].choices[1].commits[0].key, 'silent', 'IR commit from choice');
    truthy(ir.some((op) => op.op === 'label' && op.name === 'friend'), 'IR label');
    truthy(ir.some((op) => op.op === 'commit' && op.key === 'trust'), 'IR commit op');
});

test('story: plays through $.dialog, does not create its own text UI', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    const story = installStory($);
    truthy($.story === story, 'story installed');
    truthy(story.play({ text: 'Некотян: Привет!\nend' }), 'story starts');
    for (let i = 0; i < 10 && $.updates.length; ++i) {
        const fns = $.updates.slice();
        for (const fn of fns) fn();
    }
    truthy(dialog.isOpen(), 'story dialogue is rendered by $.dialog');
    eq(dialog.speaker(), 'Некотян', 'story speaker reaches dialog');
    eq(dialog.fullText(), 'Привет!', 'story text reaches dialog');
    eq(query('#__story_line').length, 0, 'story has no text label of its own');
    eq(query('#__story_box').length, 0, 'story has no text box of its own');
    eq(query('#__story_choices').length, 0, 'story has no choice UI of its own');
    for (let n = 0; n < 6 && dialog.isOpen(); ++n) {
        story.advance();
        const fns = $.updates.slice();
        for (const fn of fns) fn();
    }
    falsy(dialog.isOpen(), 'story ends through the shared dialog');
    for (let i = 0; i < 3; ++i) {
        const fns = $.updates.slice();
        for (const fn of fns) fn();
    }
    falsy(story.running(), 'story finished');
    eq($.input.lockCount(), 0, 'story and dialog released all input locks');
});

test('dialog: inspector snapshot is complete and theme validator is pure', () => {
    const backend = fakeBackend();
    const $ = makeDollar(backend);
    const dialog = installDialog($, { backend });
    dialog.define('i', { start: 'a', nodes: { a: { speaker: 'n', expression: 'calm', text: 'hello', choices: [{ text: 'ok' }] } } });
    truthy(dialog.play('i'), 'open');
    dialog.skip();
    const snap = dialog.inspect();
    eq(snap.open, true, 'inspector open');
    eq(snap.definition, 'i', 'inspector definition');
    eq(snap.step, 'a', 'inspector step');
    eq(snap.expression, 'calm', 'inspector expression');
    eq(snap.worldMode, 'cinematic', 'inspector world mode');
    eq(snap.inputLocked, true, 'inspector lock');
    truthy(Array.isArray(snap.choices), 'inspector choices');
    eq(snap.view, 'rml', 'inspector reports RML view');
    falsy(dialog.validateTheme('<div></div>').ok, 'validator rejects incomplete theme');
    truthy(dialog.validateTheme(DEFAULT_RML).ok, 'validator accepts default theme');
    dialog.close();
});

finish();
