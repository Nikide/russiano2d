// Source editing only. Execution and validation belong to $.story and native
// `r2d story validate`. Untouched rows retain their original bytes and EOLs.
export function lines(source) {
    const out = [];
    const re = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    let m;
    while ((m = re.exec(String(source))) && (m[0] || re.lastIndex < String(source).length)) {
        out.push({ text: m[1], eol: m[2] });
        if (!m[2]) break;
    }
    return out;
}

const RAW_COMMANDS = ['set', 'if', 'goto', 'wait', 'end', 'camera', 'move', 'face', 'anim', 'ai', 'image', 'fade', 'sound', 'music', 'objective', 'bubble'];
export function parseLine(raw) {
    const text = raw.trim();
    const c = { raw, kind: 'raw', text, speaker: '', expr: '', goto: '', asset: '', suffix: '', tail: '' };
    if (text.startsWith('@')) return Object.assign(c, { kind: 'directive' });
    if (text.startsWith(':')) return Object.assign(c, { kind: 'label', text: text.slice(1).trim() });
    if (text.startsWith('~')) return Object.assign(c, { kind: 'narration', text: text.slice(1).trim() });
    if (/^-\s/.test(text)) {
        const arrow = text.lastIndexOf('->');
        let body = text.slice(1, arrow < 0 ? undefined : arrow).trim();
        const suffix = /\s*(\{[^}]*\})$/.exec(body);
        if (suffix) body = body.slice(0, suffix.index).trimEnd();
        return Object.assign(c, { kind: 'choice', text: body, goto: arrow < 0 ? '' : text.slice(arrow + 2).trim(), suffix: suffix ? suffix[1] : '' });
    }
    const word = (text.split(/\s+/)[0] || '').toLowerCase();
    if (RAW_COMMANDS.includes(word)) {
        c.kind = ['set', 'if', 'goto'].includes(word) ? 'flow' : word;
        if (['image', 'sound', 'music'].includes(word)) {
            const m = /^\S+\s+(\S+)(.*)$/.exec(text);
            if (m) { c.asset = m[1]; c.tail = m[2]; }
        }
        return c;
    }
    const say = /^([^:()]+?)(?:\s*\(([^)]*)\))?\s*:\s*(.*)$/.exec(text);
    if (say) Object.assign(c, { kind: 'say', speaker: say[1].trim(), expr: (say[2] || '').trim(), text: say[3] });
    return c;
}

export function commands(source) {
    return lines(source).flatMap((row, index) => {
        if (!row.text.trim() || row.text.trim().startsWith('#')) return [];
        return [Object.assign(parseLine(row.text), { index, line: index + 1 })];
    });
}

export function patchLine(command, patch) {
    const c = command, p = patch || {};
    if (p.raw !== undefined && p.raw !== c.raw) return String(p.raw);
    const kind = p.kind || c.kind;
    const text = p.text === undefined ? c.text : String(p.text);
    const get = (key) => p[key] === undefined ? c[key] : String(p[key]);
    let next;
    if (kind === 'say') next = get('speaker').trim() + (get('expr').trim() ? ' (' + get('expr').trim() + ')' : '') + ': ' + text;
    else if (kind === 'narration') next = '~ ' + text;
    else if (kind === 'label') next = ':' + text.replace(/^:/, '');
    else if (kind === 'choice') next = '- ' + text + (c.suffix ? ' ' + c.suffix : '') + (get('goto').trim() ? ' -> ' + get('goto').trim() : '');
    else if (['image', 'sound', 'music'].includes(kind) && p.asset !== undefined && p.asset !== c.asset) next = kind + ' ' + get('asset') + c.tail;
    else next = text !== c.text ? text : c.raw.trimStart();
    // A no-op Apply must not normalize spacing in an authored row.
    const fields = ['kind', 'text', 'speaker', 'expr', 'goto', 'asset'];
    if (!fields.some((key) => p[key] !== undefined && String(p[key]) !== String(c[key]))) return c.raw;
    return (c.raw.match(/^\s*/) || [''])[0] + next;
}

export const TEMPLATES = {
    say: 'Narrator: Текст', narration: '~ Текст', choice: '- Да -> yes', label: ':label',
    flow: 'goto label', image: 'image art/bg.png 0.4', sound: 'sound sfx/click.ogg',
    wait: 'wait 1.0', raw: 'custom command',
};

export function editSource(source, op, index, value) {
    const rows = lines(source);
    const eol = (rows.find((r) => r.eol) || {}).eol || '\n';
    if (op === 'replace') {
        if (!rows[index]) return source;
        rows[index].text = String(value);
    } else if (op === 'delete') rows.splice(index, 1);
    else if (op === 'insert') {
        const at = Math.max(0, Math.min(index, rows.length));
        if (at > 0 && !rows[at - 1].eol) rows[at - 1].eol = eol;
        rows.splice(at, 0, { text: String(value), eol: at < rows.length || /[\r\n]$/.test(source) ? eol : '' });
    } else if (op === 'move') {
        if (!rows[index] || !rows[value]) return source;
        // Move row text, retaining line-ending positions and the file's EOF.
        const texts = rows.map((r) => r.text);
        texts.splice(value, 0, texts.splice(index, 1)[0]);
        rows.forEach((r, i) => { r.text = texts[i]; });
    }
    return rows.map((r) => r.text + r.eol).join('');
}
