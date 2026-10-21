
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function loadout(node, config, $) {
    const bag = bagOf(node);
    if (!bag) { node.emit('loadout:failed', { reason: 'no-inventory' }); return () => {}; }
    for (const [id, n] of counts(config.items)) if ($.items.has(id)) bag.add(id, n);
    for (const id of config.wear) if ($.items.has(id)) { if (!bag.has(id)) bag.add(id, 1); bag.wear(id); }
    node.data('loadout', config.name).emit('loadout', { name: config.name });
    return () => {};
}
