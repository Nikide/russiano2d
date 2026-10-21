// Форматирование отступов (не полноценный prettier): расставляет табы по глубине
// скобок, учитывает строки/комментарии/шаблоны через токенайзер и switch/case.
// Работает для js, css и json; разметка получает только обрезку пробелов в конце.
import { tokenizeLine } from './highlight.js';

const CLOSERS = ')]}';

// Ширина ведущего отступа в колонках (таб — до 4).
export function indentColumns(ws) {
    let n = 0;
    for (const ch of ws) n += ch === '\t' ? 4 - (n % 4) : 1;
    return n;
}

export function reindentLines(lines, lang) {
    if (lang !== 'js' && lang !== 'css' && lang !== 'json') return lines.map((s) => s.trimEnd());
    const out = [];
    const braces = [];          // { sw: это switch-блок, seenCase }
    let depth = 0, state = null;
    let commentShift = 0;       // сдвиг строки, в которой начался блочный комментарий
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i], startState = state;
        const parsed = tokenizeLine(raw, lang, state);
        state = parsed.state;
        const trimmed = raw.trim();
        let indent;
        if (startState === 'template') {
            out.push(raw);                      // содержимое шаблонной строки трогать нельзя
        } else if (startState === 'comment') {
            const ws = /^[\t ]*/.exec(raw)[0];
            const cols = Math.max(0, indentColumns(ws) + commentShift);
            out.push('\t'.repeat(Math.floor(cols / 4)) + ' '.repeat(cols % 4) + raw.slice(ws.length).trimEnd());
        } else if (!trimmed) {
            out.push('');
        } else {
            let lead = 0;
            while (lead < trimmed.length && CLOSERS.includes(trimmed[lead])) lead++;
            indent = Math.max(0, depth - lead);
            const top = braces[braces.length - 1];
            const isCase = /^(?:case\b|default\s*:)/.test(trimmed);
            if (top && top.sw && top.seenCase && !isCase && trimmed[0] !== '}') indent++;
            out.push('\t'.repeat(indent) + trimmed);
            if (isCase && top && top.sw) top.seenCase = true;
            if (state === 'comment' && startState !== 'comment') commentShift = indent * 4 - indentColumns(/^[\t ]*/.exec(raw)[0]);
        }
        // Глубина после строки: скобки вне строк и комментариев.
        for (const token of parsed.tokens) {
            if (token.cls === 'tk-str' || token.cls === 'tk-com') continue;
            for (const ch of token.text) {
                if (ch === '(' || ch === '[') depth++;
                else if (ch === '{') {
                    depth++;
                    braces.push({ sw: lang === 'js' && /\bswitch\b[^{]*\{\s*$/.test(trimmed), seenCase: false });
                } else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
                else if (ch === '}') { depth = Math.max(0, depth - 1); braces.pop(); }
            }
        }
    }
    return out;
}
