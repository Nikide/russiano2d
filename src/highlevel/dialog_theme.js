// ===========================================================================
// VN: dialog theme registry — builtin RML/RCSS, custom templates, CSS vars.
//
// Presentation only: dialog.js owns narrative state; dialog_view.js owns the
// RmlUi document. This module owns *what* the document is made of:
//   * builtin RML/RCSS (default look, fully replaceable);
//   * named themes (rml/rcss strings or file paths);
//   * a stack of pushed themes with release tokens;
//   * pure markup validation used by hot reload and the JS tests.
//
// Module has no engine access and no globals: a DialogThemes instance is owned
// by the installed $.dialog. Hot reload re-reads the *current* source; on any
// failure the last valid document stays active (dialog_view keeps it).
// ===========================================================================

export const DIALOG_ROLE_ATTR = 'data-dialog-role';

// Semantic roles required by the runtime. Author templates may add more.
export const DIALOG_REQUIRED_ROLES = ['root', 'text', 'choices'];
export const DIALOG_OPTIONAL_ROLES = [
    'box', 'speaker', 'portrait', 'portrait-image', 'continue-indicator',
    'choice', 'choice-text',
];

export const DEFAULT_RCSS = `
:root {
  --dialog-font: "Open Sans";
  --dialog-text-size: 24px;
  --dialog-name-size: 20px;
  --dialog-width: 70vw;
  --dialog-height: 180px;
  --dialog-bg: rgba(12,12,14,.92);
  --dialog-text: #ffffff;
  --dialog-name: #d4b16f;
  --dialog-portrait-size: 160px;
}
body { font-family: var(--dialog-font); color: var(--dialog-text); }
[data-dialog-role="root"] {
  position: absolute; left: 15vw; bottom: 5vh; width: var(--dialog-width);
  min-height: var(--dialog-height); background: var(--dialog-bg);
  padding: 18px 22px; border-radius: 10px;
}
[data-dialog-role="box"] { display: block; }
[data-dialog-role="speaker"] {
  display: block; color: var(--dialog-name); font-size: var(--dialog-name-size);
  margin-bottom: 8px;
}
[data-dialog-role="text"] {
  display: block; font-size: var(--dialog-text-size); line-height: 1.35;
}
[data-dialog-role="portrait"] {
  position: absolute; left: 18px; top: -120px; width: var(--dialog-portrait-size);
  height: var(--dialog-portrait-size);
}
[data-dialog-role="portrait-image"] {
  width: var(--dialog-portrait-size); height: var(--dialog-portrait-size);
}
[data-dialog-role="portrait"].inactive-speaker { opacity: .65; }
[data-dialog-role="portrait"].active-speaker { opacity: 1; }
[data-dialog-role="choices"] { display: block; margin-top: 12px; }
[data-dialog-role="choice"] {
  display: block; width: 100%; margin: 6px 0; padding: 6px 10px;
  background: #22304a; color: var(--dialog-text); border-radius: 6px;
}
[data-dialog-role="choice"]:hover, [data-dialog-role="choice"].focused {
  background: #2e405f;
}
[data-dialog-role="continue-indicator"] { display: block; text-align: right; }
[data-dialog-role="continue-indicator"].hidden { visibility: hidden; }
`;

export const DEFAULT_RML = `<rml><head><title>Re2D dialog</title></head><body>
<div data-dialog-role="root">
  <div data-dialog-role="portrait"><img data-dialog-role="portrait-image"/></div>
  <div data-dialog-role="box">
    <div data-dialog-role="speaker"></div>
    <div data-dialog-role="text"></div>
    <div data-dialog-role="continue-indicator">&#9670;</div>
  </div>
  <div data-dialog-role="choices">
    <button data-dialog-role="choice"></button>
    <button data-dialog-role="choice"></button>
    <button data-dialog-role="choice"></button>
    <button data-dialog-role="choice"></button>
    <button data-dialog-role="choice"></button>
    <button data-dialog-role="choice"></button>
  </div>
</div>
</body></rml>`;

const ROLE_NAME = /^[a-z][a-z0-9-]*$/;
export const DEFAULT_CHOICE_SLOTS = 6;

const TAG_RE = /<([A-Za-z][A-Za-z0-9-]*)\b([^>]*?)(\/?)>/g;

function roleOf(attrs) {
    const match = new RegExp(DIALOG_ROLE_ATTR + '\\s*=\\s*"([^"]*)"').exec(attrs);
    return match ? match[1] : null;
}

function countRole(text, role) {
    let count = 0;
    TAG_RE.lastIndex = 0;
    let match;
    while ((match = TAG_RE.exec(text)) !== null) {
        if (roleOf(match[2]) === role) count++;
    }
    return count;
}

/** First element with data-dialog-role=role: { tag, start, openEnd, selfClosing }. */
function findRoleElement(source, role, from) {
    TAG_RE.lastIndex = from === undefined ? 0 : from;
    let match;
    while ((match = TAG_RE.exec(source)) !== null) {
        if (roleOf(match[2]) !== role) continue;
        return { tag: match[1], start: match.index, openEnd: TAG_RE.lastIndex, selfClosing: match[3] === '/' };
    }
    return null;
}

/** Matching closing tag for an open element (same tag name, nesting-aware). */
function findClose(source, tag, openEnd) {
    const re = new RegExp('<(\\/?)' + tag + '\\b[^>]*>', 'gi');
    re.lastIndex = openEnd;
    let depth = 1;
    let match;
    while ((match = re.exec(source)) !== null) {
        const closing = match[1] === '/';
        const selfClosing = /\/>\s*$/.test(match[0]);
        if (closing) depth--;
        else if (!selfClosing) depth++;
        if (depth === 0) return { closeStart: match.index, end: re.lastIndex };
    }
    return null;
}

function outerOfRole(source, role) {
    const open = findRoleElement(source, role);
    if (!open) return null;
    if (open.selfClosing) return source.slice(open.start, open.openEnd);
    const close = findClose(source, open.tag, open.openEnd);
    return close ? source.slice(open.start, close.end) : null;
}

/**
 * Dynamic choice slots. Rebuilds the content of the element carrying
 * data-dialog-role="choices" with `slots` copies of a per-choice template:
 *   { slots: 10, template: '<button data-dialog-role="choice"><span
 *     data-dialog-role="choice-text"/></button>' }
 * `{index}` (0-based) and `{n}` (1-based) are substituted; authored ids are
 * stripped from generated copies so prepareMarkup can assign unique ids.
 * Without a template, the first authored choice element is cloned. Existing
 * choices are preserved when `slots` is not larger than their count.
 */
export function expandChoiceSlots(markup, options) {
    const source = String(markup === undefined || markup === null ? '' : markup);
    const opts = options || {};
    if (opts.slots === undefined || opts.slots === null || opts.slots === '') return source;
    const slots = Math.trunc(Number(opts.slots));
    if (!(slots >= 1 && slots <= 64)) return source;
    const template = opts.template === undefined || opts.template === null ? null : String(opts.template);
    const container = findRoleElement(source, 'choices');
    if (!container) return source;
    if (container.selfClosing) return source;
    const close = findClose(source, container.tag, container.openEnd);
    if (!close) return source;
    const content = source.slice(container.openEnd, close.closeStart);
    const existing = countRole(content, 'choice');
    if (!template && slots <= existing) return source;

    let unit = template || outerOfRole(content, 'choice') || '<button data-dialog-role="choice"></button>';
    if (countRole(unit, 'choice') === 0) unit = unit.replace(/>/, ' ' + DIALOG_ROLE_ATTR + '="choice">');
    const copies = [];
    for (let i = 0; i < slots; i++) {
        const item = unit
            .replace(/\{index\}/g, String(i))
            .replace(/\{n\}/g, String(i + 1))
            .replace(/\s+id\s*=\s*("[^"]*"|'[^']*')/gi, '');
        copies.push(item);
    }
    return source.slice(0, container.openEnd) + copies.join('\n') + source.slice(close.closeStart);
}

/** All roles present in markup, in document order (duplicates preserved). */
export function collectRoles(markup) {
    const text = String(markup === undefined || markup === null ? '' : markup);
    const roles = [];
    const re = new RegExp(DIALOG_ROLE_ATTR + '\\s*=\\s*"([^"]*)"', 'g');
    let match;
    while ((match = re.exec(text)) !== null) roles.push(match[1]);
    return roles;
}

/**
 * Inject deterministic internal ids for every semantic role occurrence, so the
 * RmlUi element binding (which addresses ids) never forces authors to write
 * ids. Duplicate roles get `-N` suffixes (choice buttons, choice-text nodes).
 * Returns { ok, markup, roles, errors } where roles maps role -> [ids].
 */
export function prepareMarkup(markup) {
    const source = String(markup === undefined || markup === null ? '' : markup);
    const errors = [];
    if (!source.trim()) errors.push({ code: 'DIALOG_RML_EMPTY', message: 'RML is empty' });

    const roles = Object.create(null);
    const seen = Object.create(null);
    const re = /<([A-Za-z][A-Za-z0-9-]*)\b([^>]*?)(\/?)>/g;
    let out = '';
    let last = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
        out += source.slice(last, match.index);
        const tag = match[1];
        const attrs = match[2];
        const roleMatch = new RegExp(DIALOG_ROLE_ATTR + '\\s*=\\s*"([^"]*)"').exec(attrs);
        if (roleMatch) {
            const role = roleMatch[1];
            if (!ROLE_NAME.test(role)) {
                errors.push({ code: 'DIALOG_RML_ROLE', message: `invalid data-dialog-role "${role}"` });
            } else {
                const index = seen[role] === undefined ? 0 : seen[role] + 1;
                seen[role] = index;
                const id = 'r2d-dlg-' + role + (index ? '-' + index : '');
                if (!roles[role]) roles[role] = [];
                roles[role].push(id);
                let rewritten = attrs;
                if (!/\bid\s*=/.test(attrs)) rewritten = attrs + ` id="${id}"`;
                else {
                    // Author ids are allowed but the runtime still keys by role;
                    // remember the existing id instead of replacing it.
                    const idMatch = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
                    if (idMatch) roles[role][roles[role].length - 1] = idMatch[1];
                }
                out += '<' + tag + rewritten + match[3] + '>';
                last = match.index + match[0].length;
                continue;
            }
        }
        out += match[0];
        last = match.index + match[0].length;
    }
    out += source.slice(last);

    for (const role of DIALOG_REQUIRED_ROLES) {
        if (!roles[role] || !roles[role].length) {
            errors.push({ code: 'DIALOG_RML_ROLE_MISSING', message: `missing data-dialog-role="${role}"` });
        }
    }
    return { ok: errors.length === 0, markup: out, roles, errors };
}

/** Pure theme validator used by $.dialog.validateTheme and hot reload. */
export function validateMarkup(markup) {
    const prepared = prepareMarkup(markup);
    const errors = prepared.errors.slice();
    if (!/<rml[\s>]/i.test(String(markup || ''))) {
        errors.push({ code: 'DIALOG_RML_ROOT', message: 'markup must start with <rml>' });
    }
    return { ok: errors.length === 0, errors };
}

/** Insert an RCSS string as an inline stylesheet into an RML document. */
export function inlineRcss(markup, rcss) {
    const css = String(rcss === undefined || rcss === null ? '' : rcss);
    if (!css.trim()) return String(markup);
    const style = `<style>${css}</style>`;
    const text = String(markup);
    if (/<\/head>/i.test(text)) return text.replace(/<\/head>/i, style + '</head>');
    if (/<head[^>]*>/i.test(text)) return text.replace(/(<head[^>]*>)/i, '$1' + style);
    return text.replace(/<rml([^>]*)>/i, `<rml$1><head>${style}</head>`);
}

/**
 * Theme registry with a push/pop stack. `define(name, {rml,rcss,template})`
 * accepts inline markup or a file path (`template`/`rml` string starting with
 * `@` or ending in .rml is resolved by the view through $.fs).
 */
export class DialogThemes {
    constructor(builtin) {
        const base = builtin || {};
        this._themes = new Map();
        this._stack = [];
        this._current = 'default';
        this.define('default', {
            rml: base.rml || DEFAULT_RML,
            rcss: base.rcss === undefined ? DEFAULT_RCSS : base.rcss,
        });
    }

    define(name, spec) {
        const id = String(name === undefined || name === null ? '' : name).trim();
        if (!id) return false;
        const source = typeof spec === 'string' ? { rml: spec } : (spec || {});
        const rml = source.rml !== undefined ? source.rml : source.template;
        const slots = source.choiceSlots;
        if (slots !== undefined && slots !== null) {
            const n = Math.trunc(Number(slots));
            if (!(n >= 1 && n <= 64) || Number(slots) !== n) return false;
        }
        if (source.choiceTemplate !== undefined && source.choiceTemplate !== null &&
            typeof source.choiceTemplate !== 'string') return false;
        const entry = {
            name: id,
            rml: rml === undefined ? null : rml,
            rcss: source.rcss === undefined ? null : source.rcss,
            font: source.font,
            choiceSlots: slots === undefined || slots === null ? null : Math.trunc(Number(slots)),
            choiceTemplate: source.choiceTemplate === undefined ? null : source.choiceTemplate,
        };
        this._themes.set(id, entry);
        return true;
    }

    has(name) { return this._themes.has(String(name)); }
    names() { return [...this._themes.keys()].sort(); }
    current() { return this._current; }

    /** Resolve a theme into the source pair the view should load. */
    resolve(name) {
        const id = name === undefined || name === null ? this._current : String(name);
        const entry = this._themes.get(id);
        if (!entry) return null;
        const base = this._themes.get('default');
        return {
            name: id,
            rml: entry.rml !== null ? entry.rml : base.rml,
            rcss: entry.rcss !== null ? entry.rcss : base.rcss,
            font: entry.font !== undefined ? entry.font : base.font,
            choiceSlots: entry.choiceSlots !== null ? entry.choiceSlots : base.choiceSlots,
            choiceTemplate: entry.choiceTemplate !== null ? entry.choiceTemplate : base.choiceTemplate,
        };
    }

    use(name) {
        const id = String(name);
        if (!this._themes.has(id)) return false;
        this._current = id;
        return true;
    }

    push(name) {
        const id = String(name);
        if (!this._themes.has(id)) return null;
        const previous = this._current;
        this._stack.push(previous);
        this._current = id;
        let released = false;
        const token = {
            theme: id,
            release: () => {
                if (released) return false;
                released = true;
                const at = this._stack.lastIndexOf(previous);
                if (at >= 0) this._stack.splice(at, 1);
                this._current = previous;
                return true;
            },
            active: () => !released,
        };
        return token;
    }

    stack() { return this._stack.slice(); }
}

/** @font-face helper for themes that ship a custom font via RCSS. */
export function fontFaceRule(family, url) {
    if (!family || !url) return '';
    return `@font-face { font-family:"${String(family)}"; src:url("${String(url)}"); }`;
}
