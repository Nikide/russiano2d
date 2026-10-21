// Очки: level:up добавляет perLevel; трата — skill-tree через data.
export default function skillPoints(node, config, $) {
    if (node.data('skillPoints') === undefined) node.data('skillPoints', config.start);
    const on = () => node.data('skillPoints', (node.data('skillPoints') || 0) + config.perLevel).emit('skillpoints', { points: node.data('skillPoints') });
    node.on('level:up', on);
    return () => node.off('level:up', on);
}
