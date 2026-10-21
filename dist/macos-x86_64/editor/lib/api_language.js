// Lightweight `$` API completion and hover helpers for the embedded editor.
// The API documentation catalog is embedded in r2d, so projects do not need
// a copied schema file just to get editor assistance.
import { JS_BUILTIN_CATALOG } from './js_builtin_catalog.js';
import { tokenizeLine } from './highlight.js';

const ID = '[A-Za-z_$Ѐ-ӿ][\\w$Ѐ-ӿ]*';
const ID_ONLY = /^[A-Za-z_$Ѐ-ӿ][\w$Ѐ-ӿ]*$/;

export function publicApiSymbols(api) {
    const docs = api && api.__r2dApiDocs;
    if (!docs || typeof docs !== 'object') return [];
    return Object.keys(docs)
        .filter((path) => path.startsWith('$.') &&
            !path.slice(2).split('.').some((part) => part.startsWith('_')))
        .map((path) => ({ path, metadata: docs[path] || {} }));
}

function inCode(line, end) {
    let quote = '', escaped = false, block = false;
    for (let i = 0; i < end; i++) {
        const ch = line[i], next = line[i + 1];
        if (block) {
            if (ch === '*' && next === '/') { block = false; i++; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) quote = '';
            continue;
        }
        if (ch === '/' && next === '/') return false;
        if (ch === '/' && next === '*') { block = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    }
    return !quote && !block;
}

/** Context when the caret follows `$.namespace.partial`, or null otherwise. */
export function apiCompletionContext(line, col) {
    if (typeof line !== 'string') return null;
    const before = line.slice(0, Math.max(0, col));
    const dot = before.lastIndexOf('.');
    if (!inCode(line, col)) return null;
    // `$` is a useful completion root by itself, before the user types a dot.
    // Accept only the standalone public root, not identifiers such as `$value`.
    if (dot < 0) {
        if (before.endsWith('$') && (before.length === 1 || !/[\w$Ѐ-ӿ]/.test(before[before.length - 2])))
            return { base: '$', member: '', fromCol: col, insertPrefix: '.' };
        return null;
    }
    const base = before.slice(0, dot).replace(/\s+/g, '');
    const member = before.slice(dot + 1);
    if (!ID_ONLY.test(member) && member !== '') return null;
    const re = new RegExp('^\\$(?:\\.' + ID + ')*$');
    if (!re.test(base)) return null;
    return { base, member, fromCol: col - member.length, insertPrefix: '' };
}

function declaredNodeAlias(source, name, seen) {
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return false;
    const visited = seen || new Set();
    if (visited.has(name)) return false;
    visited.add(name);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|[;{}\\n])\\s*(?:const|let|var)\\s+' + escaped +
        '\\s*(?::\\s*([^=;\\n]+))?=\\s*([^;\\n]*)', 'g');
    let match, declaration = null;
    while ((match = re.exec(source))) declaration = match;
    if (!declaration) return false;
    const annotation = (declaration[1] || '').trim();
    if (/^(?:R2DNode|NodeWrapper)\b/.test(annotation)) return true;
    const initializer = (declaration[2] || '').trim().replace(/^await\s+/, '');
    if (/^(?:\$\s*\(|\$\s*\.\s*_wrapper\s*\()/.test(initializer)) return true;
    // A node wrapper may flow through a simple alias or a node method call.
    const alias = initializer.match(/^([A-Za-z_$][\w$]*)(?=\s*(?:\.|$))/);
    return !!(alias && declaredNodeAlias(source, alias[1], visited));
}

/** `$('<tag>')` wrappers are R2DNode instances; follow simple local aliases. */
export function nodeApiCompletionContext(line, col, sourceText) {
    if (typeof line !== 'string') return null;
    const before = line.slice(0, Math.max(0, col));
    const dot = before.lastIndexOf('.');
    if (dot < 0 || !inCode(line, col)) return null;
    const member = before.slice(dot + 1);
    if (!ID_ONLY.test(member) && member !== '') return null;
    const receiver = before.slice(0, dot).trim().match(/([A-Za-z_$][\w$]*)$/);
    if (!receiver || !declaredNodeAlias(String(sourceText || ''), receiver[1])) return null;
    return { base: '$.fn', member, fromCol: col - member.length, insertPrefix: '' };
}

/** Return the documented $.fn method under the cursor on a node variable. */
export function nodeApiPathAt(lines, position) {
    const line = lines && position && lines[position.line];
    if (typeof line !== 'string') return '';
    const words = /[A-Za-z_$][\w$]*/g;
    let match;
    while ((match = words.exec(line))) {
        const start = match.index, end = start + match[0].length;
        if (!(start <= position.col && position.col <= end || start <= position.col - 1 && position.col - 1 < end)) continue;
        const receiver = line.slice(0, start).match(/([A-Za-z_$][\w$]*)\s*\.\s*$/);
        if (!receiver) continue;
        const source = lines.join('\n');
        const offset = lines.slice(0, position.line).reduce((n, row) => n + row.length + 1, 0) + end;
        if (declaredNodeAlias(source.slice(0, offset), receiver[1])) return '$.fn.' + match[0];
    }
    return '';
}

/** Return the immediate members available under the current `$` path. */
export function completeApiSymbols(symbols, context, limit) {
    if (!context) return [];
    const prefix = context.base + '.';
    const groups = new Map();
    for (const symbol of symbols || []) {
        if (!symbol.path.startsWith(prefix)) continue;
        const rest = symbol.path.slice(prefix.length);
        const name = rest.split('.')[0];
        if (!name || !name.toLowerCase().startsWith(context.member.toLowerCase())) continue;
        const exact = rest === name;
        const previous = groups.get(name);
        if (!previous || (exact && !previous.exact)) {
            groups.set(name, { name, path: prefix + name, metadata: symbol.metadata || {}, exact });
        }
    }
    return [...groups.values()].sort((a, b) => {
        const ae = a.name.toLowerCase() === context.member.toLowerCase() ? 0 : 1;
        const be = b.name.toLowerCase() === context.member.toLowerCase() ? 0 : 1;
        return ae - be || a.name.localeCompare(b.name);
    }).slice(0, limit || 12);
}

function simpleJsType(expression) {
    const value = String(expression || '').trim().replace(/^\(+|\)+$/g, '').trim();
    if (!value) return '';
    if (/^(?:['"`])/.test(value)) return 'String';
    if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?n?$/.test(value))
        return value.endsWith('n') ? 'BigInt' : 'Number';
    if (/^(?:true|false)$/.test(value)) return 'Boolean';
    if (/^\[/.test(value)) return 'Array';
    if (/^\/.*\/[dgimsuvy]*$/.test(value)) return 'RegExp';
    const created = value.match(/^new\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/);
    if (created) return created[1];
    if (/^(?:Iterator\.from|.*\.(?:values|keys|entries|matchAll)\s*\()/.test(value)) return 'IteratorObject';
    if (/^(?:Array\.from|Array\.of)\s*\(/.test(value)) return 'Array';
    if (/^(?:Object\.(?:entries|keys|values)|.*\.split)\s*\(/.test(value)) return 'Array';
    if (/\.(?:filter|flat|flatMap|map|slice|toReversed|toSorted|toSpliced|with)\s*\(/.test(value)) return 'Array';
    if (/\.(?:at|charAt|concat|normalize|padEnd|padStart|repeat|replace|replaceAll|slice|substring|toLowerCase|toUpperCase|trim|trimEnd|trimStart)\s*\(/.test(value)) return 'String';
    if (/^(?:String|Number|Boolean|BigInt)\s*\(/.test(value))
        return value.match(/^([A-Za-z]+)/)[1];
    if (/^(?:Math|JSON|Reflect|Atomics|Iterator|globalThis|Object|Array|String|Number|Boolean|BigInt|Date|RegExp|Map|Set|WeakMap|WeakSet|Promise|Symbol|Proxy)$/.test(value))
        return value;
    return '';
}

function inferredVariableType(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|[;{}\\n])\\s*(?:const|let|var)\\s+' + escaped +
        '\\s*(?::\\s*([^=;\\n]+))?=\\s*([^;\\n]*)', 'g');
    let match, last = null;
    while ((match = re.exec(source))) last = match;
    if (!last) return '';
    const annotation = (last[1] || '').trim();
    const primitive = annotation.match(/^(string|number|boolean|bigint|symbol|object)\b/i);
    if (primitive) return ({ string: 'String', number: 'Number', boolean: 'Boolean', bigint: 'BigInt' })[primitive[1].toLowerCase()] || 'Object';
    const generic = annotation.match(/^(?:Readonly)?(Array|Map|Set|WeakMap|WeakSet|Promise|Date|RegExp|Iterator|IteratorObject|AsyncIteratorObject|Float16Array|Float32Array|Float64Array|Int8Array|Int16Array|Int32Array|Uint8Array|Uint8ClampedArray|Uint16Array|Uint32Array|BigInt64Array|BigUint64Array)\b/);
    if (generic) return generic[1];
    if (/\[\]\s*$/.test(annotation)) return 'Array';
    return simpleJsType(last[2]);
}

/**
 * Resolve standard JavaScript completion from the ECMAScript-only TypeScript
 * catalog. This intentionally handles direct globals, literals, constructors,
 * and plainly declared local variables without pretending to be a full TS
 * checker or exposing browser APIs the QuickJS runtime does not have.
 */
export function jsCompletionContext(sourceText, offset, force, catalog) {
    const source = String(sourceText || '').slice(0, Math.max(0, offset));
    const lineStart = source.lastIndexOf('\n') + 1;
    const line = source.slice(lineStart);
    if (!inCode(line, line.length)) return null;
    const builtins = catalog || JS_BUILTIN_CATALOG;
    const dot = line.lastIndexOf('.');
    if (dot >= 0) {
        const member = line.slice(dot + 1);
        if (ID_ONLY.test(member) || member === '') {
            const receiverText = line.slice(0, dot).trim();
            const receiver = receiverText.match(/(?:new\s+[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(.*\)|[A-Za-z_$][\w$]*(?:\[[^\]]+\])?(?:\.[A-Za-z_$][\w$]*\s*\([^;]*\))+|[A-Za-z_$][\w$]*|\[.*\]|['"`][^'"`]*['"`]|(?:\d+(?:\.\d*)?|\.\d+))$/);
            if (receiver) {
                let type = simpleJsType(receiver[0]);
                if (!type && /^[A-Za-z_$][\w$]*$/.test(receiver[0])) type = inferredVariableType(source, receiver[0]);
                if (type && builtins.types[type]) {
                    return { mode: 'js', target: 'member', type, member,
                        fromCol: lineStart + dot + 1, insertPrefix: '', receiver: receiver[0] };
                }
            }
        }
    }
    const token = line.match(/[A-Za-z_$][\w$]*$/);
    if (!token) return force ? { mode: 'js', target: 'global', member: '',
        fromCol: lineStart + line.length, insertPrefix: '' } : null;
    if (!force && token[0].length < 2) return null;
    const hasMemberDot = dot >= 0 && dot === line.length - token[0].length - 1;
    if (hasMemberDot) return null;
    return { mode: 'js', target: 'global', member: token[0],
        fromCol: lineStart + line.length - token[0].length, insertPrefix: '' };
}

export function completeJavaScriptSymbols(context, catalog, limit) {
    if (!context) return [];
    const builtins = catalog || JS_BUILTIN_CATALOG;
    let candidates;
    if (context.target === 'member') {
        const type = builtins.types[context.type];
        if (!type) return [];
        // Namespace objects/constructors complete their own static members;
        // values complete the methods on their instance prototype.
        const namespaceNames = new Set(['Math', 'JSON', 'Reflect', 'Atomics', 'globalThis']);
        const staticOnly = namespaceNames.has(context.type) || context.receiver === context.type;
        candidates = staticOnly ? type.static : type.instance;
    } else {
        candidates = builtins.globals;
    }
    const query = String(context.member || '').toLowerCase();
    return candidates.filter((item) => item.name.toLowerCase().startsWith(query))
        .sort((a, b) => {
            const ae = a.name.toLowerCase() === query ? 0 : 1;
            const be = b.name.toLowerCase() === query ? 0 : 1;
            return ae - be || a.name.localeCompare(b.name);
        }).slice(0, limit || 16).map((item) => ({
            name: item.name,
            path: item.path,
            metadata: { ...item, kind: item.kind },
        }));
}

export function javascriptSymbolAt(lines, position, catalog) {
    const line = lines && lines[position && position.line];
    if (typeof line !== 'string' || !position) return null;
    const words = /[A-Za-z_$][\w$]*/g;
    let match;
    while ((match = words.exec(line))) {
        const start = match.index, end = start + match[0].length;
        if (!(start <= position.col && position.col <= end || start <= position.col - 1 && position.col - 1 < end)) continue;
        const source = lines.join('\n');
        const lineOffset = lines.slice(0, position.line).reduce((n, row) => n + row.length + 1, 0);
        const context = jsCompletionContext(source, lineOffset + end, true, catalog);
        if (!context || context.member !== match[0]) continue;
        const item = completeJavaScriptSymbols(context, catalog, 512).find((candidate) => candidate.name === match[0]);
        if (item) return item;
    }
    return null;
}

/**
 * Return declaration locations for a deliberately small, lexical JS outline.
 * This is navigation aid only: it recognizes named function/class declarations
 * and simple const/let/var bindings, and does not claim to resolve scopes.
 */
export function javascriptDocumentSymbols(lines) {
    const out = [];
    let state = null;
    for (let line = 0; line < (lines || []).length; line++) {
        const row = String(lines[line]);
        const parsed = tokenizeLine(row, 'js', state);
        state = parsed.state;
        const tokens = [];
        let col = 0;
        for (const token of parsed.tokens) {
            if (token.cls !== 'tk-com' && token.cls !== 'tk-str' && token.cls !== 'tk-num') {
                const re = /[A-Za-z_$][\w$]*/g;
                let match;
                while ((match = re.exec(token.text))) {
                    tokens.push({ text: match[0], col: col + match.index, cls: token.cls });
                }
            }
            col += token.text.length;
        }
        for (let i = 0; i < tokens.length; i++) {
            const keyword = tokens[i].text;
            if (!['function', 'class', 'const', 'let', 'var'].includes(keyword)) continue;
            let next = i + 1;
            if (keyword === 'function' && tokens[next] && tokens[next].text === '*') next++;
            const candidate = tokens[next];
            if (!candidate || candidate.cls === 'tk-kw' || candidate.text === '$') continue;
            // Destructuring and property declarations need a parser; omitting
            // them keeps the outline honest and avoids bogus navigation hits.
            if (!/^[A-Za-z_$][\w$]*$/.test(candidate.text)) continue;
            const kind = keyword === 'function' ? 'function' : keyword === 'class' ? 'class' : keyword;
            out.push({ name: candidate.text, kind, line, col: candidate.col,
                label: candidate.text + '  · ' + kind + '  · ' + (line + 1),
                detail: row.trim().slice(0, 140) });
        }
    }
    return out;
}

// --- подсказка параметров вызова ------------------------------------------------

const CALL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'with', 'else', 'do']);

/** Ближайший незакрытый вызов `f(` перед концом текста: { callee, argIndex } либо null. */
export function callContext(sourcePrefix) {
    const src = String(sourcePrefix || '').slice(-4000);
    const stack = [];
    let quote = '', i = 0;
    while (i < src.length) {
        const ch = src[i], next = src[i + 1];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = '';
            i++; continue;
        }
        if (ch === '/' && next === '/') { const e = src.indexOf('\n', i); if (e < 0) return null; i = e; continue; }
        if (ch === '/' && next === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 2; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i++; continue; }
        if (ch === '(') {
            const m = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/.exec(src.slice(Math.max(0, i - 120), i));
            stack.push({ type: '(', callee: m ? m[1].replace(/\s+/g, '') : '', index: 0 });
        } else if (ch === '[' || ch === '{') stack.push({ type: ch });
        else if (ch === ')' || ch === ']' || ch === '}') stack.pop();
        else if (ch === ',' && stack.length && stack[stack.length - 1].type === '(') stack[stack.length - 1].index++;
        i++;
    }
    if (quote) return null;
    for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].type !== '(') continue;
        const f = stack[k];
        if (!f.callee || CALL_KEYWORDS.has(f.callee.split('.').pop()) && !f.callee.includes('.')) return null;
        // Для вложенных литералов индекс аргумента берётся у самого вызова.
        return { callee: f.callee, argIndex: f.index };
    }
    return null;
}

function splitTopLevel(text) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of text) {
        if ('([{<'.includes(ch)) depth++;
        else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

/** Разбор сигнатуры "(a: T, b?: U): R" в { params, ret }. */
export function parseSignature(signature) {
    const text = String(signature || '');
    if (text[0] !== '(') return null;
    let depth = 0, end = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') { depth--; if (!depth) { end = i; break; } }
    }
    if (end < 0) return null;
    const ret = text.slice(end + 1).replace(/^\s*(?::|→|=>)\s*/, '').trim();
    return { params: splitTopLevel(text.slice(1, end)), ret };
}

function localSignature(source, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp('function\\s*\\*?\\s*' + esc + '\\s*\\(([^)]*)\\)'),
        new RegExp('(?:const|let|var)\\s+' + esc + '\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>'),
        new RegExp('(?:const|let|var)\\s+' + esc + '\\s*=\\s*(?:async\\s*)?function\\s*\\*?\\s*\\(([^)]*)\\)'),
        new RegExp('^\\s*(?:async\\s+|static\\s+)*' + esc + '\\s*\\(([^)]*)\\)\\s*\\{', 'm'),
    ];
    for (const re of patterns) {
        const m = re.exec(source);
        if (m) return { params: splitTopLevel(m[1]), ret: '', doc: '' };
    }
    return null;
}

/**
 * Данные для подсказки параметров: { name, parts, active, doc, ret } либо null.
 * Источники по порядку: функция из этого файла, документированный `$` API
 * (включая методы узла), стандартные JS-функции.
 */
export function paramHintFor(source, offset, apiSymbols, catalog) {
    const ctx = callContext(String(source || '').slice(0, offset));
    if (!ctx) return null;
    const callee = ctx.callee, member = callee.split('.').pop();
    let info = null;
    if (!callee.includes('.')) {
        const found = localSignature(source, callee);
        if (found) info = found;
    }
    if (!info) {
        let path = callee.startsWith('$.') ? callee : '';
        if (!path) {
            const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(callee);
            if (m && declaredNodeAlias(String(source).slice(0, offset), m[1])) path = '$.fn.' + m[2];
        }
        const symbol = path && (apiSymbols || []).find((s) => s.path === path);
        if (symbol) {
            const meta = symbol.metadata || {};
            const args = Array.isArray(meta.args) ? meta.args : null;
            if (args) info = { params: args.map((a) => (a.name || 'arg') + (a.optional ? '?' : '') + (a.type ? ': ' + a.type : '')), ret: meta.returns || '', doc: meta.description || '' };
            else {
                const parsed = parseSignature(meta.signature);
                if (parsed) info = { params: parsed.params, ret: parsed.ret, doc: meta.description || '' };
            }
        }
    }
    if (!info) {
        const book = catalog || JS_BUILTIN_CATALOG;
        const pool = [...book.globals];
        for (const t of Object.values(book.types || {})) pool.push(...(t.static || []));
        const item = pool.find((x) => x.path === callee) || (!callee.includes('.') ? pool.find((x) => x.name === callee) : null);
        const parsed = item && parseSignature(item.signature);
        if (parsed) info = { params: parsed.params, ret: parsed.ret, doc: item.description || '' };
    }
    if (!info) return null;
    const active = info.params.length ? Math.min(ctx.argIndex, info.params.length - 1) : -1;
    return { name: member, parts: info.params, active, doc: info.doc, ret: info.ret };
}

// --- сниппеты ---------------------------------------------------------------------

// `$0` — куда поставить каретку; отступ строк добавляется по строке вставки.
export const SNIPPETS = [
    { prefix: 'fn', body: 'function $0() {\n\t\n}', doc: 'function' },
    { prefix: 'arrow', body: 'const $0 = () => {\n\t\n};', doc: 'стрелочная функция' },
    { prefix: 'for', body: 'for (let i = 0; i < $0; i++) {\n\t\n}', doc: 'цикл for' },
    { prefix: 'forof', body: 'for (const $0 of ) {\n\t\n}', doc: 'цикл for…of' },
    { prefix: 'if', body: 'if ($0) {\n\t\n}', doc: 'условие' },
    { prefix: 'ife', body: 'if ($0) {\n\t\n} else {\n\t\n}', doc: 'if / else' },
    { prefix: 'sw', body: 'switch ($0) {\n\tcase 1:\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', doc: 'switch' },
    { prefix: 'log', body: 'console.log($0);', doc: 'console.log' },
    { prefix: 'try', body: 'try {\n\t$0\n} catch (e) {\n\t\n}', doc: 'try / catch' },
    { prefix: 'node', body: "$('<$0>')", doc: 'новый узел $(\'<тег>\')' },
    { prefix: 'ready', body: '$.ready(() => {\n\t$0\n});', doc: '$.ready — старт игры' },
];

export function snippetItems(member, limit) {
    const q = String(member || '').toLowerCase();
    if (q.length < 2) return [];
    return SNIPPETS.filter((s) => s.prefix.startsWith(q) && s.prefix !== q + '!').slice(0, limit || 4).map((s) => ({
        name: s.prefix, path: 'snippet.' + s.prefix, snippet: s.body,
        metadata: { kind: 'snippet', signature: 'сниппет', description: s.doc },
    }));
}

/** Объявления в этом файле (функции, классы, const/let/var) как элементы автодополнения. */
export function localSymbolItems(lines, member, limit) {
    const q = String(member || '').toLowerCase();
    if (!q) return [];
    const seen = new Set();
    const out = [];
    for (const s of javascriptDocumentSymbols(lines)) {
        if (seen.has(s.name) || !s.name.toLowerCase().startsWith(q) || s.name === member) continue;
        seen.add(s.name);
        out.push({ name: s.name, path: 'local.' + s.name, metadata: { kind: 'local', signature: s.kind, description: 'объявлено в файле, строка ' + (s.line + 1) } });
        if (out.length >= (limit || 6)) break;
    }
    return out;
}
