// ===========================================================================
// Markdown → RML для ответов агента в чате (RmlUi не понимает Markdown).
// Поддержано: заголовки, **жирный**, *курсив*, `код`, блоки ``` ```, списки (- * 1.), цитаты >,
// ссылки [текст](url), разделитель ---, таблицы (как моноширинный блок). Весь текст экранируется
// ДО разметки, поэтому HTML/RML из ответа модели никогда не попадает в документ.
// ===========================================================================

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Строчная разметка поверх уже экранированного текста. */
export function inlineMd(raw) {
    const keep = [];
    let t = esc(raw).replace(/`([^`\n]+)`/g, (_, c) => { keep.push('<span class="mdx-c">' + c + '</span>'); return '\u0001' + (keep.length - 1) + '\u0002'; });
    t = t.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<span class="mdx-a">$1</span>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<span class="mdx-b">$1</span>')
        .replace(/__([^_\n]+)__/g, '<span class="mdx-b">$1</span>')
        .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,:;!?]|$)/g, '$1<span class="mdx-i">$2</span>')
        .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,:;!?]|$)/g, '$1<span class="mdx-i">$2</span>');
    return t.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[Number(i)]);
}

export function markdownToRml(text) {
    const lines = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push('<div class="mdx-p">' + para.map(inlineMd).join('\n') + '</div>'); para = []; } };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = /^\s*```/.exec(line);
        if (fence) {
            flush();
            const code = [];
            for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
            out.push('<div class="mdx-code">' + esc(code.join('\n')) + '</div>');
            continue;
        }
        if (!line.trim()) { flush(); continue; }
        let m;
        if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) { flush(); out.push('<div class="mdx-h mdx-h' + Math.min(3, m[1].length) + '">' + inlineMd(m[2]) + '</div>'); continue; }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<div class="mdx-hr"></div>'); continue; }
        if ((m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
            flush();
            const depth = Math.min(3, (m[1].replace(/\t/g, '    ').length / 2) | 0);
            const bullet = /\d/.test(m[2]) ? m[2] : '•';
            out.push('<div class="mdx-li" style="margin-left:' + (depth * 14) + 'px;"><span class="mdx-bul">' + esc(bullet) + '</span><span class="mdx-lt">' + inlineMd(m[3]) + '</span></div>');
            continue;
        }
        if ((m = /^\s*>\s?(.*)$/.exec(line))) { flush(); out.push('<div class="mdx-q">' + inlineMd(m[1]) + '</div>'); continue; }
        if (/^\s*\|.*\|\s*$/.test(line)) {
            flush();
            const rows = [];
            for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  │  '));
            i--;
            out.push('<div class="mdx-code">' + esc(rows.join('\n')) + '</div>');
            continue;
        }
        para.push(line);
    }
    flush();
    return out.join('');
}
