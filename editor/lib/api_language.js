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
