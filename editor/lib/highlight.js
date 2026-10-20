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
        const text = escapeRml(t.text).replace(/ /g, '&#160;').replace(/\t/g, '&#160;&#160;&#160;&#160;');
        html += t.cls ? '<span class="' + t.cls + '">' + text + '</span>' : text;
    }
    return html;
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
