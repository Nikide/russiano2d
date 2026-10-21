// ===========================================================================
// Нечёткий поиск для Quick Open и Command Palette: буквы запроса должны
// встретиться по порядку; очки за подряд идущие буквы, начало слова и имя
// файла. Чистая функция (tests/js/editor_code_model_test.mjs).
// ===========================================================================

export function fuzzyScore(query, text) {
    const q = String(query || '').toLowerCase();
    const t = String(text || '');
    const tl = t.toLowerCase();
    if (!q) return { score: 0, hits: [] };
    const nameStart = Math.max(tl.lastIndexOf('/') + 1, 0);
    let score = 0, ti = 0, prev = -2;
    const hits = [];
    for (let qi = 0; qi < q.length; qi++) {
        const ch = q[qi];
        if (ch === ' ') continue;
        let found = tl.indexOf(ch, ti);
        if (found < 0) return null;
        // Предпочесть совпадение в начале слова, если оно есть дальше.
        const boundary = tl.slice(ti).search(new RegExp('(^|[/_.\\-\\s])' + ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        if (boundary >= 0 && prev !== found - 1) {
            const at = ti + boundary + (tl[ti + boundary] === ch ? 0 : 1);
            if (tl[at] === ch) found = at;
        }
        score += 1;
        if (found === prev + 1) score += 4;
        if (found === 0 || /[/_.\-\s]/.test(tl[found - 1] || '')) score += 3;
        if (found >= nameStart) score += 2;
        if (t[found] !== tl[found] && t[found] === ch.toUpperCase()) score += 1;
        hits.push(found);
        prev = found;
        ti = found + 1;
    }
    score -= Math.min(10, t.length / 20);
    return { score, hits };
}

// items: [{ label, ... }] → отсортированные совпадения с полем match.
export function fuzzyFilter(query, items, key, limit) {
    const pick = key || ((it) => it.label);
    if (!query) return items.slice(0, limit || items.length).map((it) => ({ item: it, match: { score: 0, hits: [] } }));
    const out = [];
    for (const it of items) {
        const match = fuzzyScore(query, pick(it));
        if (match) out.push({ item: it, match });
    }
    out.sort((a, b) => b.match.score - a.match.score || pick(a.item).length - pick(b.item).length);
    return limit ? out.slice(0, limit) : out;
}
