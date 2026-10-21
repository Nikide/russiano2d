// Подписи: текстовые узлы-метки следуют за объектами.
export default function colorCues(node, config, $) {
    const rules = config.cues.map((s) => s.split('=')).filter((p) => p.length === 2).map(([sel, mark]) => [sel.trim(), mark.trim()]);
    const labels = new Map();
    const stop = $.updateFor(node, () => {
        const seen = new Set();
        for (const [sel, mark] of rules) $(sel).each((i, w) => {
            const raw = w.get(0); seen.add(raw);
            let l = labels.get(raw);
            if (!l) { l = $('<text>', { text: mark, size: config.size }).appendTo($.world); labels.set(raw, l); }
            const p = w.pos(); l.at(p.x, p.y - w.height() / 2 - config.size);
        });
        for (const [raw, l] of labels) if (!seen.has(raw)) { l.remove(); labels.delete(raw); }
    });
    return () => { stop(); for (const l of labels.values()) l.remove(); };
}
