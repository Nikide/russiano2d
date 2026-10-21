
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

// Ступени улучшения разбираются из строк «из→в: ингредиенты».
function parse(list) {
    return list.map((s) => { const [a, b] = s.split(':'); const [from, to] = (a || '').split('→').map((x) => x && x.trim());
        const need = (b || '').split(',').map((p) => p.split('=')).filter((p) => p[0] && p[0].trim()).map(([k, v]) => [k.trim(), Number(v) || 1]);
        return from && to ? { from, to, need } : null; }).filter(Boolean);
}

export default function craftUpgrade(node, config, $) {
    const steps = parse(config.upgrades);
    const on = (e) => {
        const bag = bagOf(node), item = e.data && e.data.item, s = steps.find((x) => x.from === item);
        if (!bag || !s || !bag.has(item) || s.need.some(([k, v]) => bag.count(k) < v)) return node.emit('upgrade:denied', { item });
        for (const [k, v] of s.need) bag.remove(k, v);
        bag.remove(item, 1);
        bag.add(s.to, 1);
        node.emit('upgraded', { from: item, to: s.to }); node.emit('inv:changed', {});
    };
    node.on('upgrade', on);
    return () => node.off('upgrade', on);
}
