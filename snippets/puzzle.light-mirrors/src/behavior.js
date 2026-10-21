// Луч: отрезки до ближайшего зеркала (пересечение с прямоугольником), отражение по углу зеркала (45°-зеркала).
function hitRect(p, d, n) {
    const q = n.pos(), hw = n.width() / 2, hh = n.height() / 2;
    let tmin = -Infinity, tmax = Infinity;
    for (const [o, dir, lo, hi] of [[p.x, d.x, q.x - hw, q.x + hw], [p.y, d.y, q.y - hh, q.y + hh]]) {
        if (Math.abs(dir) < 1e-9) { if (o < lo || o > hi) return null; continue; }
        let a = (lo - o) / dir, b = (hi - o) / dir; if (a > b) [a, b] = [b, a];
        tmin = Math.max(tmin, a); tmax = Math.min(tmax, b);
    }
    return tmax >= tmin && tmin > 0.5 ? tmin : null;
}

export default function lightMirrors(node, config, $) {
    let lit = false;
    return $.updateFor(node, (dt, self) => {
        let p = self.pos(), d = { x: config.direction[0], y: config.direction[1] };
        const l = Math.hypot(d.x, d.y) || 1; d = { x: d.x / l, y: d.y / l };
        const path = [p];
        let hitReceiver = false, last = null;
        for (let i = 0; i < config.bounces; i++) {
            let best = null;
            const rec = $(config.receiver);
            if (rec.length) { const t = hitRect(p, d, rec); if (t !== null && t <= config.range) best = { t, n: rec, receiver: true }; }
            $(config.mirrors).each((k, m) => { if (m.get(0) === last) return; const t = hitRect(p, d, m); if (t !== null && t <= config.range && (!best || t < best.t)) best = { t, n: m }; });
            if (!best) { path.push({ x: p.x + d.x * config.range, y: p.y + d.y * config.range }); break; }
            p = { x: p.x + d.x * best.t, y: p.y + d.y * best.t };
            path.push(p);
            if (best.receiver) { hitReceiver = true; break; }
            last = best.n.get(0);
            const a = best.n.angle() * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a), dot = d.x * nx + d.y * ny;
            d = { x: d.x - 2 * dot * nx, y: d.y - 2 * dot * ny };
        }
        self.data('beam', path);
        if (hitReceiver !== lit) { lit = hitReceiver; self.emit('beam:lit', { on: lit }); if (lit) $.emit(config.solvedEvent, { puzzle: self.attr('id') }); }
    });
}
