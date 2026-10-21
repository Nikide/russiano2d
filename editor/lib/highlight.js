// ===========================================================================
// Подсветка JS/JSON/RML для редактора кода: построчный токенизатор с
// состоянием между строками (многострочный комментарий, шаблонная строка).
// Выход — RML-разметка из <span class="tk-…">, текст экранирован.
// Чистые функции: tests/js/editor_code_model_test.mjs.
// ===========================================================================

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export ' +
    'extends finally for function if import in instanceof let new return super switch this throw try ' +
    'typeof var void while with yield async await of static get set').split(' '));
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

export function escapeRml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function languageOf(path) {
    const p = String(path || '').toLowerCase();
    if (p.endsWith('.js') || p.endsWith('.mjs')) return 'js';
    if (p.endsWith('.json')) return 'json';
    if (p.endsWith('.rml') || p.endsWith('.html') || p.endsWith('.xml')) return 'markup';
    if (p.endsWith('.rcss') || p.endsWith('.css')) return 'css';
    return 'text';
}

// Токены одной строки: [{ cls, text }], и состояние на начало следующей.
// state: null | 'comment' | 'template'.
export function tokenizeLine(line, lang, state) {
    const out = [];
    const push = (cls, text) => { if (text) out.push({ cls, text }); };
    if (lang === 'text') { push('', line); return { tokens: out, state: null }; }
    if (lang === 'markup') return tokenizeMarkup(line, state);
    let i = 0, st = state || null;
    const n = line.length;
    while (i < n) {
        if (st === 'comment') {
            const end = line.indexOf('*/', i);
            if (end < 0) { push('tk-com', line.slice(i)); i = n; break; }
            push('tk-com', line.slice(i, end + 2)); i = end + 2; st = null; continue;
        }
        if (st === 'template') {
            let j = i;
            while (j < n && line[j] !== '`') { if (line[j] === '\\') j++; j++; }
            if (j >= n) { push('tk-str', line.slice(i)); i = n; break; }
            push('tk-str', line.slice(i, j + 1)); i = j + 1; st = null; continue;
        }
        const ch = line[i];
        if (ch === '/' && line[i + 1] === '/' && lang !== 'json') { push('tk-com', line.slice(i)); break; }
        if (ch === '/' && line[i + 1] === '*') { st = 'comment'; push('tk-com', '/*'); i += 2; continue; }
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < n && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
            const text = line.slice(i, Math.min(n, j + 1));
            // В JSON строка перед «:» — ключ.
            const rest = line.slice(j + 1).trimStart();
            push(lang === 'json' && rest[0] === ':' ? 'tk-key' : 'tk-str', text);
            i = j + 1; continue;
        }
        if (ch === '`' && lang === 'js') { st = 'template'; push('tk-str', '`'); i++; continue; }
        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || ''))) {
            const m = /^(0x[0-9a-fA-F_]+|[0-9_]*\.?[0-9_]+(e[+-]?[0-9]+)?n?)/.exec(line.slice(i));
            const t = m ? m[0] : ch;
            push('tk-num', t); i += t.length; continue;
        }
        if (/[A-Za-z_$Ѐ-ӿ]/.test(ch)) {
            const m = /^[\w$Ѐ-ӿ]+/.exec(line.slice(i));
            const w = m[0];
            let cls = '';
            if (KEYWORDS.has(w) && lang === 'js') cls = 'tk-kw';
            else if (LITERALS.has(w)) cls = 'tk-lit';
            else if (w === '$') cls = 'tk-dollar';
            else if (line[i + w.length] === '(') cls = 'tk-fn';
            else if (lang === 'css' && line.slice(i + w.length).trimStart()[0] === ':') cls = 'tk-key';
            push(cls, w); i += w.length; continue;
        }
        if (ch === '$') { push('tk-dollar', '$'); i++; continue; }
        // Прочее — пунктуация и пробелы, склеиваем подряд.
        let j = i + 1;
        while (j < n && !/[A-Za-z0-9_$"'`\/.Ѐ-ӿ]/.test(line[j])) j++;
        push(/^\s+$/.test(line.slice(i, j)) ? '' : 'tk-punct', line.slice(i, j));
        i = j;
    }
    return { tokens: out, state: st };
}

function tokenizeMarkup(line, state) {
    const out = [];
    const push = (cls, text) => { if (text) out.push({ cls, text }); };
    let i = 0, st = state || null;
    const n = line.length;
    while (i < n) {
        if (st === 'comment') {
            const end = line.indexOf('-->', i);
            if (end < 0) { push('tk-com', line.slice(i)); i = n; break; }
            push('tk-com', line.slice(i, end + 3)); i = end + 3; st = null; continue;
        }
        if (line.startsWith('<!--', i)) { st = 'comment'; push('tk-com', '<!--'); i += 4; continue; }
        if (line[i] === '<') {
            const m = /^<\/?[\w.-]*/.exec(line.slice(i));
            push('tk-kw', m[0]); i += m[0].length;
            // атрибуты до «>»
            while (i < n && line[i] !== '>') {
                const a = /^\s*([\w:-]+)/.exec(line.slice(i));
                if (a) { push('', a[0].slice(0, a[0].length - a[1].length)); push('tk-key', a[1]); i += a[0].length; continue; }
                const s = /^=\s*("[^"]*"?|'[^']*'?)/.exec(line.slice(i));
                if (s) { push('tk-punct', '='); push('tk-str', s[1]); i += s[0].length; continue; }
                push('', line[i]); i++;
            }
            if (i < n) { push('tk-kw', '>'); i++; }
            continue;
        }
        const j = line.indexOf('<', i);
        const end = j < 0 ? n : j;
        push('', line.slice(i, end)); i = end;
    }
    return { tokens: out, state: st };
}

// RML строки: токены → <span>. Пустая строка — неразрывный пробел, иначе
// RmlUi схлопывает её высоту.
export function lineToRml(tokens) {
    if (!tokens.length) return '&#160;';
    let html = '';
    for (const t of tokens) {
        // Пробелы — неразрывные: парсер RML схлопывает пробел перед первым
        // <span> строки, и отступ пропадал. Ширина в моноширинном шрифте та же.
        // «{{» и «}}» RmlUi принимает за привязку данных и роняет разбор строки: скобки — числовыми сущностями.
        const text = escapeRml(t.text).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/ /g, '&#160;').replace(/\t/g, '&#160;&#160;&#160;&#160;');
        html += t.cls ? '<span class="' + t.cls + '">' + text + '</span>' : text;
    }
    return html;
}

const API_CREATE = /^(?:create|add|append|insert|spawn|clone|copy|load|mount|register|install|alias|make|new)/i;
const API_DELETE = /^(?:remove|delete|destroy|dispose|kill|drop|purge|unregister)/i;

function apiActionClass(name) {
    if (API_CREATE.test(name)) return 'tk-api-create';
    if (API_DELETE.test(name)) return 'tk-api-delete';
    return 'tk-api';
}

/** Build the immutable-per-document lookup used by semantic `$` highlighting. */
export function createApiHighlightContext(symbols, sourceLines) {
    const paths = new Map((symbols || []).map((s) => [s.path, s.metadata || {}]));
    const fnNames = new Map();
    for (const [path, metadata] of paths) {
        if (path.startsWith('$.fn.')) fnNames.set(path.slice(5), metadata);
    }
    const source = (sourceLines || []).join('\n');
    const aliases = new Set();
    const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\$\s*\(/g;
    let match;
    while ((match = declaration.exec(source))) aliases.add(match[1]);
    return { paths, fnNames, aliases };
}

/** Apply semantic `$` API colors on top of JS lexical tokens. `<tag>` is
 * recognized only as `$()` input; regular JS strings/comments stay untouched. */
export function highlightApiTokens(tokens, line, context) {
    if (!tokens || !line || !context || !context.paths.size) return tokens;
    const { paths, fnNames, aliases } = context;
    let match;

    const code = new Array(line.length).fill(false);
    let col = 0;
    for (const token of tokens) {
        const codeToken = token.cls !== 'tk-str' && token.cls !== 'tk-com';
        for (let i = 0; i < token.text.length && col + i < code.length; i++) code[col + i] = codeToken;
        col += token.text.length;
    }
    const ranges = [];
    const add = (start, end, cls) => { if (end > start) ranges.push({ start, end, cls }); };
    const isCode = (start, end) => {
        for (let i = start; i < end; i++) if (!code[i]) return false;
        return true;
    };

    // Color known explicit API paths, distinguishing their callable action.
    const chain = /\$(?:\s*\.\s*[A-Za-z_$Ѐ-ӿ][\w$Ѐ-ӿ]*)*/g;
    while ((match = chain.exec(line))) {
        if (!isCode(match.index, match.index + match[0].length)) continue;
        const segments = [...match[0].matchAll(/[A-Za-z_$Ѐ-ӿ][\w$Ѐ-ӿ]*/g)];
        if (!segments.length) continue;
        add(match.index, match.index + 1, 'tk-api-root');
        let path = '$';
        for (let i = 1; i < segments.length; i++) {
            const segment = segments[i];
            path += '.' + segment[0];
            if (!paths.has(path) && ![...paths.keys()].some((candidate) => candidate.startsWith(path + '.'))) continue;
            const metadata = paths.get(path) || {};
            const callable = metadata.kind === 'function' || metadata.kind === 'method';
            add(match.index + segment.index, match.index + segment.index + segment[0].length,
                callable ? apiActionClass(segment[0]) : 'tk-api-namespace');
        }
    }

    // Node wrapper methods remain semantic when the receiver is a local alias
    // created by `$('<tag>')`, matching the editor's hover/completion model.
    if (aliases.size) {
        const aliasMethod = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g;
        while ((match = aliasMethod.exec(line))) {
            const name = match[2], metadata = fnNames.get(name);
            const start = match.index + match[0].lastIndexOf(name);
            if (aliases.has(match[1]) && metadata && isCode(start, start + name.length))
                add(start, start + name.length, apiActionClass(name));
        }
    }
    const wrappedMethod = /\$\s*\([^;]*?\)\s*\.\s*([A-Za-z_$][\w$]*)/g;
    while ((match = wrappedMethod.exec(line))) {
        const name = match[1], start = match.index + match[0].lastIndexOf(name);
        if (fnNames.has(name) && isCode(start, start + name.length))
            add(start, start + name.length, apiActionClass(name));
    }

    // A quoted engine node tag is an object factory argument, not a normal
    // string. Restrict this coloring to the direct `$('<tag>')` form.
    const tagArg = /\$\s*\(\s*(['"])(<[A-Za-z][\w.-]*>)\1/g;
    while ((match = tagArg.exec(line))) {
        const start = match.index + match[0].indexOf(match[2]);
        const quoteStart = match.index + match[0].indexOf(match[1]);
        if (!isCode(match.index, quoteStart)) continue;
        add(start, start + match[2].length, 'tk-api-create');
    }

    if (!ranges.length) return tokens;
    const out = [];
    col = 0;
    for (const token of tokens) {
        let offset = 0;
        while (offset < token.text.length) {
            const absolute = col + offset;
            const range = ranges.find((r) => absolute >= r.start && absolute < r.end);
            const cls = range ? range.cls : token.cls;
            let end = offset + 1;
            while (end < token.text.length) {
                const next = ranges.find((r) => col + end >= r.start && col + end < r.end);
                if ((next ? next.cls : token.cls) !== cls) break;
                end++;
            }
            const text = token.text.slice(offset, end);
            const last = out[out.length - 1];
            if (last && last.cls === cls) last.text += text;
            else out.push({ cls, text });
            offset = end;
        }
        col += token.text.length;
    }
    return out;
}

// Состояния на начало каждой строки: считаем один раз на версию документа.
export function lineStates(lines, lang) {
    const states = new Array(lines.length);
    let st = null;
    for (let i = 0; i < lines.length; i++) {
        states[i] = st;
        st = tokenizeLine(lines[i], lang, st).state;
    }
    return states;
}

/** Matching delimiters outside strings and comments, keyed by `line:column`. */
export function bracketPairs(lines, lang) {
    const pairs = new Map();
    if (lang !== 'js' && lang !== 'json') return pairs;
    const openFor = { ')': '(', ']': '[', '}': '{' };
    const stack = [];
    let state = null;
    for (let line = 0; line < lines.length; line++) {
        const row = tokenizeLine(lines[line], lang, state);
        state = row.state;
        let col = 0;
        for (const token of row.tokens) {
            if (token.cls !== 'tk-str' && token.cls !== 'tk-com') {
                for (let offset = 0; offset < token.text.length; offset++) {
                    const ch = token.text[offset], pos = { line, col: col + offset };
                    if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, pos });
                    else if (openFor[ch]) {
                        let at = stack.length - 1;
                        while (at >= 0 && stack[at].ch !== openFor[ch]) at--;
                        if (at >= 0) {
                            const open = stack[at];
                            pairs.set(open.pos.line + ':' + open.pos.col, pos);
                            pairs.set(pos.line + ':' + pos.col, open.pos);
                            stack.length = at;
                        }
                    }
                }
            }
            col += token.text.length;
        }
    }
    return pairs;
}

/** Return the matching delimiter at or immediately before the caret. */
export function matchingBracket(pairs, position) {
    if (!pairs || !position) return null;
    return pairs.get(position.line + ':' + position.col) ||
        pairs.get(position.line + ':' + (position.col - 1)) || null;
}

/** Multi-line `{...}` ranges available for the code gutter's fold controls. */
export function foldingRanges(lines, pairs) {
    const ranges = new Map();
    for (const [key, end] of pairs || []) {
        const [line, col] = key.split(':').map(Number);
        if (lines[line] && lines[line][col] === '{' && end.line > line + 1) {
            ranges.set(line, Math.max(ranges.get(line) || 0, end.line));
        }
    }
    return ranges;
}

export function isWordCharacter(ch) {
    return !!ch && /[\w$Ѐ-ӿ]/.test(ch);
}
