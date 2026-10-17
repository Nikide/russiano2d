// ===========================================================================
// VN: dialog view — RML/RCSS presentation backend keyed by semantic roles.
//
// dialog.js owns narrative state (text, typing, choices, backlog…). This module
// only renders that state into an RmlUi document and never mutates game state.
// Authors mark elements with data-dialog-role; internal deterministic ids are
// injected by prepareMarkup(), so no hardcoded DOM ids leak into logic.
//
// The backend is a small object (see makeUiBackend) so qjs tests can drive the
// whole view without RmlUi or a window. Hot reload keeps the last valid document
// when the new RML/RCSS fails to load.
// ===========================================================================

import { prepareMarkup, inlineRcss, validateMarkup } from './dialog_theme.js';

const ACTION_ATTR = 'data-dialog-action';

/** Backend over engine.ui (loadMarkup/unload/show/hide/setText/...). */
export function makeUiBackend(ui) {
    if (!ui || typeof ui.loadMarkup !== 'function') return null;
    return {
        loadMarkup: (name, markup) => ui.loadMarkup(name, markup),
        unload: (doc) => ui.unload(doc),
        show: (doc) => ui.show(doc),
        hide: (doc) => ui.hide(doc),
        setText: (doc, element, text) => ui.setText(doc, element, String(text)),
        setProperty: (doc, element, prop, value) => ui.setProperty(doc, element, prop, String(value)),
        setClass: (doc, element, cls, add) => ui.setClass(doc, element, cls, add),
        setAttr: (doc, element, name, value) => ui.setAttr(doc, element, name, String(value)),
        on: typeof ui.on === 'function'
            ? (doc, element, event, fn) => ui.on(doc, element, event, fn)
            : null,
    };
}

/** Action elements (data-dialog-action="next" etc.) in document order. */
export function collectActions(markup) {
    const text = String(markup || '');
    const actions = [];
    const re = new RegExp(ACTION_ATTR + '\\s*=\\s*"([^"]*)"', 'g');
    let match;
    while ((match = re.exec(text)) !== null) actions.push(match[1]);
    return actions;
}

const SLOT_CLASSES = ['slot-left', 'slot-center', 'slot-right', 'slot-far-left', 'slot-far-right'];
const STATE_CLASSES = ['typing', 'ready', 'has-speaker', 'has-portrait', 'has-choices',
    'auto', 'skip', 'backlog-open'];

function isPathSource(value) {
    return typeof value === 'string' && (/\.(rml|rcss)$/i.test(value) || value.startsWith('@'));
}

function readSource(readText, value) {
    if (!isPathSource(value)) return value;
    const path = value.startsWith('@') ? value.slice(1) : value;
    const text = typeof readText === 'function' ? readText(path) : null;
    return text === undefined || text === null ? null : text;
}

/**
 * Create a role-based view.
 * options: { backend, themes, readText, onAction(name) }
 * themes: DialogThemes instance (resolve(current())).
 */
export function createDialogView(options) {
    const backend = options && options.backend;
    const themes = options && options.themes;
    const readText = options && options.readText;
    const onAction = options && typeof options.onAction === 'function' ? options.onAction : null;

    let doc = -1;
    let roles = Object.create(null);
    let actionIds = [];
    let applied = new Set();      // state classes currently on root
    let slotClass = '';
    let visible = false;
    let lastValid = null;         // { name, markup }
    let errors = [];

    function rootId() { return roles.root && roles.root[0] || null; }
    function idsOf(role) { return roles[role] || []; }

    function setClassOn(role, cls, add) {
        for (const id of idsOf(role)) backend.setClass(doc, id, cls, add);
    }

    function destroyDoc() {
        if (doc >= 0 && backend) backend.unload(doc);
        doc = -1;
        roles = Object.create(null);
        actionIds = [];
        applied = new Set();
    }

    function bindActions(markup) {
        actionIds = [];
        const names = collectActions(markup);
        if (!backend.on || !names.length) return;
        // Re-run role prep to get the element carrying each action attr. Actions
        // usually live on unique ids; bind by role order where possible.
        const re = /<([A-Za-z][A-Za-z0-9-]*)\b([^>]*?)>/g;
        let match;
        let index = 0;
        while ((match = re.exec(markup)) !== null) {
            const attrs = match[2];
            const action = new RegExp(ACTION_ATTR + '\\s*=\\s*"([^"]*)"').exec(attrs);
            if (!action) continue;
            const idMatch = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
            if (idMatch) {
                const id = idMatch[1];
                backend.on(doc, id, 'click', () => { if (onAction) onAction(action[1]); });
                actionIds.push({ action: action[1], id });
            }
            index++;
        }
        void index;
    }

    function apply(markup, prepared, name) {
        const id = backend.loadMarkup('dialog:' + name, markup);
        if (typeof id !== 'number' || !(id >= 0)) {
            errors = [{ code: 'DIALOG_RML_LOAD', message: 'RmlUi rejected the dialog document' }];
            return false;
        }
        destroyDoc();
        doc = id;
        roles = prepared.roles;
        lastValid = { name, markup };
        errors = [];
        bindActions(prepared.markup);
        if (visible) backend.show(doc);
        return true;
    }

    /** Compile the current theme into a loadable document and load it. */
    function load(name) {
        if (!backend || !themes) return false;
        const theme = themes.resolve(name);
        if (!theme) {
            errors = [{ code: 'DIALOG_THEME_UNKNOWN', message: `unknown dialog theme "${name}"` }];
            return false;
        }
        const rmlSource = readSource(readText, theme.rml);
        const rcssSource = readSource(readText, theme.rcss);
        if (rmlSource === null) {
            errors = [{ code: 'DIALOG_RML_MISSING', message: 'dialog RML source was not found' }];
            return false;
        }
        const prepared = prepareMarkup(rmlSource);
        if (!prepared.ok) { errors = prepared.errors; return false; }
        let full = inlineRcss(prepared.markup, rcssSource === null ? '' : rcssSource);
        if (theme.font && theme.font.family && theme.font.url) {
            const rule = `@font-face { font-family:"${theme.font.family}"; src:url("${theme.font.url}"); }`;
            full = inlineRcss(full, rule);
        }
        return apply(full, prepared, theme.name);
    }

    /** Hot reload: re-read the current theme source; keep last valid on failure. */
    function reload() {
        const previous = themes ? themes.current() : null;
        const ok = load(previous);
        if (!ok && lastValid) {
            // Re-show the last valid document: load() failed before destroying it,
            // so the old doc id is still live unless load partially replaced it.
            if (doc < 0 && previous) load(previous);
            return false;
        }
        return ok;
    }

    function setStateClasses(state) {
        const root = rootId();
        if (!root) return;
        const wanted = new Set();
        if (state.typing) wanted.add('typing'); else wanted.add('ready');
        if (state.hasSpeaker) wanted.add('has-speaker');
        if (state.hasPortrait) wanted.add('has-portrait');
        if (state.hasChoices) wanted.add('has-choices');
        if (state.auto) wanted.add('auto');
        if (state.skip) wanted.add('skip');
        if (state.backlogOpen) wanted.add('backlog-open');
        for (const cls of STATE_CLASSES) {
            const on = wanted.has(cls);
            const was = applied.has(cls);
            if (on !== was) backend.setClass(doc, root, cls, on);
        }
        applied = wanted;
        for (const cls of SLOT_CLASSES) {
            if (slotClass === cls) backend.setClass(doc, root, cls, true);
            else if (slotClass) backend.setClass(doc, root, cls, false);
        }
    }

    const view = {
        get ready() { return doc >= 0; },
        get document() { return doc; },
        get roles() { return roles; },
        get errors() { return errors.slice(); },
        get actions() { return actionIds.slice(); },

        load,
        reload,
        validate(markup) { return validateMarkup(markup); },
        theme(name) { return load(name === undefined ? themes.current() : name); },

        show() {
            visible = true;
            if (doc >= 0) backend.show(doc);
            return view;
        },
        hide() {
            visible = false;
            if (doc >= 0) backend.hide(doc);
            return view;
        },
        destroy() { destroyDoc(); visible = false; },

        setSpeaker(speaker) {
            const name = speaker && speaker.name !== undefined ? String(speaker.name) : '';
            for (const id of idsOf('speaker')) backend.setText(doc, id, name);
            return view;
        },
        setText(text) {
            for (const id of idsOf('text')) backend.setText(doc, id, String(text === undefined || text === null ? '' : text));
            return view;
        },
        setContinue(active) {
            setClassOn('continue-indicator', 'hidden', !active);
            return view;
        },
        setPortrait(portrait) {
            const src = portrait && portrait.src ? String(portrait.src) : '';
            for (const id of idsOf('portrait-image')) {
                if (src) backend.setAttr(doc, id, 'src', src);
                else backend.setAttr(doc, id, 'src', '');
            }
            const slot = portrait && portrait.slot ? String(portrait.slot) : '';
            slotClass = SLOT_CLASSES.includes('slot-' + slot) ? 'slot-' + slot : '';
            for (const id of idsOf('portrait')) {
                for (const cls of SLOT_CLASSES) backend.setClass(doc, id, cls, slotClass === cls);
                backend.setClass(doc, id, 'active-speaker', !!(portrait && portrait.active));
                backend.setClass(doc, id, 'inactive-speaker', !!(portrait && portrait.inactive));
            }
            return view;
        },
        setChoices(list) {
            const choices = Array.isArray(list) ? list : [];
            const buttons = idsOf('choice');
            for (let i = 0; i < buttons.length; i++) {
                const id = buttons[i];
                const choice = choices[i];
                backend.setProperty(doc, id, 'display', choice ? '' : 'none');
                if (!choice) continue;
                backend.setText(doc, id, String(choice.text === undefined ? '' : choice.text));
                backend.setClass(doc, id, 'focused', !!choice.focused);
                const labels = idsOf('choice-text');
                if (labels[i]) backend.setText(doc, labels[i], String(choice.text === undefined ? '' : choice.text));
            }
            setClassOn('choices', 'hidden', choices.length === 0);
            return view;
        },
        /** Feed the full view model; this is the only method dialog.js needs. */
        render(model) {
            if (doc < 0) return view;
            view.setSpeaker({ name: model.speakerName || '' });
            view.setText(model.text || '');
            view.setContinue(!model.typing);
            view.setPortrait({
                src: model.portrait || '',
                slot: model.slot || '',
                active: model.speakerActive !== false,
                inactive: model.speakerActive === false,
            });
            view.setChoices(model.choices || []);
            setStateClasses(model);
            return view;
        },
    };
    return view;
}
