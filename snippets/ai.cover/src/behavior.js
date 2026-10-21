// Укрытие: точка за ближайшим укрытием на линии «угроза → укрытие».
export default function cover(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        const th = sel(config.threat);
        if (!th.length || self.distanceTo(th) > config.danger) return;
        const p = self.pos(), t = th.pos();
        let best = null;
        $(config.covers).each((i, c) => { const q = c.pos(), d = Math.hypot(q.x - p.x, q.y - p.y); if (!best || d < best.d) best = { c, q, d }; });
        if (!best) return;
        const dx = best.q.x - t.x, dy = best.q.y - t.y, l = Math.hypot(dx, dy) || 1;
        const off = Math.max(best.c.width(), best.c.height()) / 2 + self.width();
        const spot = { x: best.q.x + dx / l * off, y: best.q.y + dy / l * off };
        if (Math.hypot(spot.x - p.x, spot.y - p.y) > 4) self.moveTowards(spot, config.speed);
        else { self.velocity(0, self.velocity().y); self.data('inCover', true); }
    });
}
