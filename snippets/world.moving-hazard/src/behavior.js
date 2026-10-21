
function parsePoints(text) {
    return String(text || '').split(';').map((p) => p.split(',').map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => ({ x, y }));
}

export default function movingHazard(node, config, $) {
    const pts = parsePoints(config.points);
    let i = 0, cd = 0;
    return $.updateFor(node, (dt, self) => {
        if (pts.length >= 2) {
            const p = self.pos(), t = pts[i], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy), step = config.speed * dt;
            if (d <= step) { self.at(t.x, t.y); i = (i + 1) % pts.length; } else self.at(p.x + dx / d * step, p.y + dy / d * step);
        }
        if (config.spin) self.angle(self.angle() + config.spin * dt);
        cd -= dt * 1000;
        if (cd > 0) return;
        let hit = false;
        $(config.targets).each((k, w) => { if (self.overlaps(w)) { w.damage(config.damage, self, 'hazard'); hit = true; } });
        if (hit) cd = config.interval;
    });
}
