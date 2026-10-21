// Цель: заполняет attempt.target; вне дальности — отказ 'range'.
export default function targeting(node, config, $) {
    const tryIt = (e) => {
        if (e.data.id !== config.id || !e.data.ok) return;
        const p = node.pos();
        let t = null;
        if (config.mode === 'self') t = p;
        else if (config.mode === 'mouse') t = $.input.mouseWorld();
        else $(config.targets).each((i, n) => { const q = n.pos(), d = Math.hypot(q.x - p.x, q.y - p.y); if (!t || d < t.d) t = { x: q.x, y: q.y, d, node: n }; });
        if (!t || Math.hypot(t.x - p.x, t.y - p.y) > config.range) { e.data.ok = false; e.data.reason = 'range'; return; }
        e.data.target = { x: t.x, y: t.y };
    };
    node.on('ability:try', tryIt);
    return () => node.off('ability:try', tryIt);
}
