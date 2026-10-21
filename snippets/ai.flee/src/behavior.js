// Бегство: скорость от угрозы, пока она в радиусе.
export default function flee(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        const t = sel(config.threat);
        if (!t.length) return;
        const a = self.pos(), b = t.pos();
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d >= config.radius || d === 0) return;
        self.velocity(dx / d * config.speed, dy / d * config.speed);
    });
}
