// Путь: точки по порядку; в конце — событие path:end и остановка (или круг).
function parsePoints(text) {
    return String(text || '').split(';').map((p) => p.split(',').map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => ({ x, y }));
}

export default function followPath(node, config, $) {
    const pts = parsePoints(config.points);
    let i = 0, wait = 0, done = !pts.length;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        if (wait > 0) { wait -= dt * 1000; return; }
        const p = self.pos(), t = pts[i];
        if (Math.hypot(t.x - p.x, t.y - p.y) > 3) { self.moveTowards(t, config.speed); return; }
        wait = config.pause;
        i++;
        if (i >= pts.length) { if (config.loop) i = 0; else { done = true; self.velocity(0, 0); self.emit('path:end', {}); } }
    });
}
