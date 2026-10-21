
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

function parse(list) {
    const out = {};
    for (const s of list) { const [a, b] = s.split(':'); if (!a || !a.trim()) continue;
        out[a.trim()] = (b || '').split(',').map((p) => p.split('=')).filter((p) => p[0] && p[0].trim()).map(([k, v]) => [k.trim(), Number(v) || 1]); }
    return out;
}

export default function disassemble(node, config, $) {
    const table = parse(config.parts);
    const on = (e) => {
        const bag = bagOf(node), item = e.data && e.data.item, parts = table[item];
        if (!bag || !parts || !bag.has(item)) return node.emit('disassemble:denied', { item });
        bag.remove(item, 1);
        for (const [k, v] of parts) bag.add(k, v);
        node.emit('disassembled', { item, parts }); node.emit('inv:changed', {});
    };
    node.on('disassemble', on);
    return () => node.off('disassemble', on);
}
