
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

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function chestLoot(node, config, $) {
    const bag = bagOf(node);
    if (!bag) { node.emit('loot:failed', { reason: 'no-container' }); return () => {}; }
    const got = roll($, parseTable(config.table), config.rolls);
    for (const [id, n] of Object.entries(got)) if ($.items.has(id)) bag.add(id, n);
    node.emit('loot:filled', { items: got });
    return () => {};
}
