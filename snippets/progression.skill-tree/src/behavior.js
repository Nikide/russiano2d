// Дерево: data('skills') — открытые; требования — другие узлы.
export default function skillTree(node, config, $) {
    const tree = Object.fromEntries(config.nodes.map((s) => s.split(':')).filter((p) => p[0]).map(([id, cost, req]) =>
        [id.trim(), { cost: Number(cost) || 0, req: (req || '').split('|').map((x) => x.trim()).filter(Boolean) }]));
    node.data('skillTree', tree);
    const on = (e) => {
        const id = e.data && e.data.id, n = tree[id], have = new Set(node.data('skills') || []);
        if (!n || have.has(id)) return node.emit('skill:denied', { id, reason: 'unknown' });
        if (n.req.some((r) => !have.has(r))) return node.emit('skill:denied', { id, reason: 'requires' });
        const pts = node.data('skillPoints') || 0;
        if (pts < n.cost) return node.emit('skill:denied', { id, reason: 'points' });
        have.add(id);
        node.data('skillPoints', pts - n.cost).data('skills', [...have]).emit('skill:unlocked', { id });
    };
    node.on('skill:unlock', on);
    return () => node.off('skill:unlock', on);
}
