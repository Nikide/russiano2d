// Сброс: очки = сумма цен открытых узлов skill-tree; деньги — событием money.
export default function respec(node, config, $) {
    const on = () => {
        const tree = node.data('skillTree') || {}, have = node.data('skills') || [];
        if (config.price && (Number(node.data('money')) || 0) < config.price) return node.emit('respec:denied', { reason: 'money' });
        const refund = have.reduce((s, id) => s + ((tree[id] || {}).cost || 0), 0);
        if (config.price) node.emit('money', { delta: -config.price, reason: 'respec' });
        node.data('skills', []).data('activeSkills', []).data('skillPoints', (node.data('skillPoints') || 0) + refund).emit('respec:done', { refund });
    };
    node.on('respec', on);
    return () => node.off('respec', on);
}
