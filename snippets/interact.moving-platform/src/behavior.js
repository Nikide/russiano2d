
function parsePoints(text) {
    return String(text || '').split(';').map((p) => p.split(',').map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => ({ x, y }));
}

export default function movingPlatform(node, config, $) {
    const pts = parsePoints(config.points);
    let i = 0, dir = 1, wait = 0;
    node.addClass('platform');
    return $.updateFor(node, (dt, self) => {
        if (pts.length < 2) return;
        if (wait > 0) { wait -= dt * 1000; return; }
        const p = self.pos(), t = pts[i], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy), step = config.speed * dt;
        if (d > step) { self.at(p.x + dx / d * step, p.y + dy / d * step); return; }
        self.at(t.x, t.y);
        wait = config.stop;
        if (config.pingPong) { if (i + dir < 0 || i + dir >= pts.length) dir = -dir; i += dir; } else i = (i + 1) % pts.length;
        self.emit('platform:stop', { index: i });
    });
}
