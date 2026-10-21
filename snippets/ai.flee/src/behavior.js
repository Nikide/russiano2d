// Бегство: скорость от угрозы, пока она в радиусе.
export default function flee(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const t = $(config.threat);
        if (!t.length) return;
        const a = self.pos(), b = t.pos();
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d >= config.radius || d === 0) return;
        self.velocity(dx / d * config.speed, dy / d * config.speed);
    });
}
