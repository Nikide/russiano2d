// Реакция: событие damaged с источником-узлом → externalVelocity от источника.
export default function knockbackReaction(node, config, $) {
    const on = (e) => {
        const src = e.data.source;
        if (!src || typeof src !== 'object' || !e.data.amount) return;
        const s = $(src);
        if (!s.length) return;
        const p = node.pos(), q = s.pos(), dx = p.x - q.x, dy = p.y - q.y, l = Math.hypot(dx, dy) || 1;
        const v = Math.min(config.max, e.data.amount * config.force);
        node.externalVelocity(dx / l * v, dy / l * v, config.decay);
    };
    node.on('damaged', on);
    return () => node.off('damaged', on);
}
