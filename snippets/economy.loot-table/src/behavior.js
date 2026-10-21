
// Таблица добычи: «id=вес=мин-макс»; детерминированно при $.random.seed.
function parseTable(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number(p[1]) > 0).map(([id, w, r]) => {
        const [lo, hi] = String(r || '1').split('-').map(Number);
        return { id: id.trim(), weight: Number(w), min: lo || 1, max: hi || lo || 1 };
    });
}
function roll($, table, rolls) {
    const out = {};
    for (let i = 0; i < rolls && table.length; i++) {
        const e = $.random.weighted(table.map((t) => ({ value: t, weight: t.weight })));
        out[e.id] = (out[e.id] || 0) + $.random.int(e.min, e.max);
    }
    return out;
}

export default function lootTable(node, config, $) {
    const table = parseTable(config.table);
    node.data('lootTable', table);
    const on = () => node.emit('loot', { items: roll($, table, config.rolls) });
    node.on('loot:roll', on);
    return () => node.off('loot:roll', on);
}
