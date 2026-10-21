// Слух: глобальное событие noise — если в радиусе × чуткость, событие heard.
export default function hearing(node, config, $) {
    const on = (e) => {
        const n = e.data || {};
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
        const p = node.pos();
        if (Math.hypot(n.x - p.x, n.y - p.y) > (n.radius || 100) * config.range) return;
        node.data('lastKnown', { x: n.x, y: n.y });
        node.emit('heard', { x: n.x, y: n.y });
    };
    $.on('noise', on);
    return () => $.off('noise', on);
}
