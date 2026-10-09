// ===========================================================================
// Модель разметки RmlUi для RmlUi Studio (docs/SDK.md §8): терпимый разбор
// `.rml` с позициями в исходном тексте, правки через подстановку подстрок и
// проверки формы. Файлы остаются обычным текстом — модель никогда не пишет их
// «своим» видом: меняется только тот фрагмент, который правит человек.
// Чистая логика без движка (tests/js/sdk_rml_test.mjs).
// ===========================================================================

import { err, warn } from './kit.js';

const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

const entity = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrUnescape = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parseAttrs(src) {
    const out = [];
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(src)) !== null) {
        const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
        out.push({ name: m[1], value: raw === undefined ? '' : attrUnescape(raw), bare: raw === undefined });
    }
    return out;
}

/**
 * Разбор: { root, nodes, diagnostics }. `nodes` — все элементы в порядке документа.
 * Узел: { tag, attrs, start, end (границы стартового тега), selfClosing,
 *         innerStart, innerEnd, closeStart, children, parent, depth, index }.
 */
export function parse(text) {
    const src = String(text);
    const diagnostics = [];
    const nodes = [];
    const root = { tag: '#root', attrs: [], children: [], parent: null, depth: -1, index: -1, start: 0, end: 0, innerStart: 0, innerEnd: src.length, selfClosing: false };
    const stack = [root];
    let i = 0;
    while (i < src.length) {
        const lt = src.indexOf('<', i);
        if (lt < 0) break;
        if (src.startsWith('<!--', lt)) {
            const e = src.indexOf('-->', lt + 4);
            if (e < 0) { diagnostics.push(err('SDK_RML_UNCLOSED', 'Комментарий <!-- не закрыт', { offset: lt })); break; }
            i = e + 3; continue;
        }
        if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
            const e = src.indexOf('>', lt);
            if (e < 0) break;
            i = e + 1; continue;
        }
        if (src[lt + 1] === '/') {
            const e = src.indexOf('>', lt);
            if (e < 0) { diagnostics.push(err('SDK_RML_UNBALANCED', 'Закрывающий тег без «>»', { offset: lt })); break; }
            const name = src.slice(lt + 2, e).trim();
            const top = stack[stack.length - 1];
            if (stack.length > 1 && top.tag === name) {
                top.innerEnd = lt; top.closeStart = lt;
                stack.pop();
            } else {
                diagnostics.push(err('SDK_RML_UNBALANCED', 'Закрывающий тег </' + name + '> не соответствует открытому ' + (stack.length > 1 ? '<' + top.tag + '>' : '(нет открытых)'), { offset: lt, tag: name }));
                // самовосстановление: если такой тег открыт выше — закрыть всё до него
                const k = stack.map((n) => n.tag).lastIndexOf(name);
                if (k > 0) { while (stack.length > k) { const n = stack.pop(); n.innerEnd = lt; n.closeStart = lt; } }
            }
            i = e + 1; continue;
        }
        // стартовый тег: ищем «>» вне кавычек
        let j = lt + 1, quote = '';
        while (j < src.length) {
            const c = src[j];
            if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
            j++;
        }
        if (j >= src.length) { diagnostics.push(err('SDK_RML_UNBALANCED', 'Стартовый тег без «>»', { offset: lt })); break; }
        let body = src.slice(lt + 1, j);
        const selfClosing = body.endsWith('/');
        if (selfClosing) body = body.slice(0, -1);
        const m = /^\s*([^\s/>]+)([\s\S]*)$/.exec(body);
        if (!m) { i = j + 1; continue; }
        const parent = stack[stack.length - 1];
        const node = { tag: m[1], attrs: parseAttrs(m[2]), start: lt, end: j + 1, selfClosing, children: [], parent, depth: stack.length - 1, index: nodes.length,
            innerStart: j + 1, innerEnd: j + 1, closeStart: -1 };
        parent.children.push(node);
        nodes.push(node);
        if (!selfClosing) stack.push(node);
        i = j + 1;
    }
    while (stack.length > 1) {
        const n = stack.pop();
        diagnostics.push(err('SDK_RML_UNCLOSED', 'Тег <' + n.tag + '> не закрыт', { offset: n.start, tag: n.tag }));
        n.innerEnd = src.length;
    }
    if (!nodes.length || nodes[0].tag !== 'rml') diagnostics.push(err('SDK_RML_ROOT', 'Корневой элемент документа должен быть <rml>', { offset: 0 }));
    return { root, nodes, diagnostics, text: src };
}

export function attr(node, name) {
    const a = node.attrs.find((x) => x.name === name);
    return a ? a.value : undefined;
}

/** «tag#id.cls1.cls2» — как селектор RCSS. */
export function label(node) {
    const id = attr(node, 'id'), cls = attr(node, 'class');
    return node.tag + (id ? '#' + id : '') + (cls ? '.' + String(cls).trim().split(/\s+/).join('.') : '');
}

/** Элементы дерева для списка: depth для отступа. `scope` — узел, чьё поддерево показать (по умолчанию весь документ). */
export function flatten(parsed, scope) {
    const out = [];
    const walk = (n) => { out.push(n); for (const c of n.children) walk(c); };
    for (const c of (scope || parsed.root).children) walk(c);
    return out;
}

export function findByTag(parsed, tag) { return parsed.nodes.find((n) => n.tag === tag) || null; }

function startTagText(node, attrs) {
    const parts = attrs.map((a) => (a.bare ? a.name : a.name + '="' + attrEscape(a.value) + '"'));
    return '<' + node.tag + (parts.length ? ' ' + parts.join(' ') : '') + (node.selfClosing ? '/>' : '>');
}

/** Новый текст документа с заменёнными атрибутами узла (порядок сохраняется, новые — в конец). */
export function setAttrs(text, node, patch) {
    const attrs = node.attrs.map((a) => Object.assign({}, a));
    for (const name of Object.keys(patch)) {
        const v = patch[name];
        const i = attrs.findIndex((a) => a.name === name);
        if (v === null || v === undefined || v === '') { if (i >= 0) attrs.splice(i, 1); continue; }
        if (i >= 0) attrs[i] = { name, value: String(v), bare: false }; else attrs.push({ name, value: String(v), bare: false });
    }
    return text.slice(0, node.start) + startTagText(node, attrs) + text.slice(node.end);
}

/** Узел без дочерних элементов: его текст можно править. */
export function isLeaf(node) { return !node.selfClosing && node.children.length === 0; }

export function innerText(text, node) {
    return isLeaf(node) ? text.slice(node.innerStart, node.innerEnd).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
}

export function setInnerText(text, node, value) {
    if (!isLeaf(node)) throw new Error('Текст можно править только у элемента без дочерних элементов');
    return text.slice(0, node.innerStart) + entity(value) + text.slice(node.innerEnd);
}

/** Ссылки на стили: [{ node, href }] из <link type="text/rcss" href="…"/>. */
export function links(parsed) {
    return parsed.nodes.filter((n) => n.tag === 'link' && /rcss|css/i.test(attr(n, 'type') || '') && attr(n, 'href')).map((n) => ({ node: n, href: attr(n, 'href') }));
}

/** Заменить href ссылок на стили по карте { старый: новый }. Правки идут с конца: смещения остаются верными. */
export function retargetLinks(text, map) {
    const parsed = parse(text);
    let out = text;
    for (const l of links(parsed).sort((a, b) => b.node.start - a.node.start)) {
        if (map[l.href] !== undefined) out = setAttrs(out, l.node, { href: map[l.href] });
    }
    return out;
}

/** Гарантирует id у <body>: нужен, чтобы предпросмотр мог прижать документ к окну просмотра. */
export function withBodyId(text, id) {
    const parsed = parse(text);
    const body = findByTag(parsed, 'body');
    if (!body) return { text, id: null };
    const cur = attr(body, 'id');
    if (cur) return { text, id: cur };
    return { text: setAttrs(text, body, { id }), id };
}

// --- RCSS ---------------------------------------------------------------------------------------------
/** Проверки формы: комментарии и скобки. Те же правила, что в нативном валидаторе. */
export function checkRcss(text) {
    const out = [];
    const src = String(text);
    let depth = 0, i = 0, line = 1;
    while (i < src.length) {
        const c = src[i];
        if (c === '\n') line++;
        if (c === '/' && src[i + 1] === '*') {
            const e = src.indexOf('*/', i + 2);
            if (e < 0) { out.push(err('SDK_RCSS_COMMENT', 'Комментарий /* не закрыт (строка ' + line + ')', { line })); return out; }
            for (let k = i; k < e; k++) if (src[k] === '\n') line++;
            i = e + 2; continue;
        }
        if (c === '"' || c === "'") {
            const q = c;
            i++;
            while (i < src.length && src[i] !== q && src[i] !== '\n') i++;
        } else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth < 0) { out.push(err('SDK_RCSS_BRACES', 'Лишняя «}» в строке ' + line, { line })); depth = 0; }
        }
        i++;
    }
    if (depth > 0) out.push(err('SDK_RCSS_BRACES', 'Не закрыто блоков «{»: ' + depth, { line }));
    return out;
}

export function checkRml(text) {
    const parsed = parse(text);
    const out = parsed.diagnostics.slice();
    if (!out.length && !findByTag(parsed, 'body')) out.push(warn('SDK_RML_NO_BODY', 'В документе нет <body>: показывать нечего'));
    return out;
}
