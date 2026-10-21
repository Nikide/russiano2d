
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

// Кошелёк узла — data('money'); изменения — событием 'money' { delta, reason }.
function money(w) { return Number(w.data('money')) || 0; }

export default function craftRepair(node, config, $) {
    const on = (e) => {
        const item = e.data && e.data.item, bag = bagOf(node);
        if (!bag || !item) return;
        const cost = counts(config.cost);
        if (cost.some(([k, v]) => bag.count(k) < v) || money(node) < config.money) return node.emit('repair:denied', { item });
        for (const [k, v] of cost) bag.remove(k, v);
        if (config.money) node.emit('money', { delta: -config.money, reason: 'repair' });
        node.emit('repair', { item });
    };
    node.on('repair-request', on);
    return () => node.off('repair-request', on);
}
