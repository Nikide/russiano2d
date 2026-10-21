// Трансформ: поля x, y, angle.
export default function replicateTransform(node, config, $) {
    node.net({ id: node.attr('id'), owner: config.owner, fields: ['x', 'y', 'angle'], interpolation: config.interpolation });
    return () => $.net.unreplicate(node);
}
