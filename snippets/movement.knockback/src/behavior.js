// Отбрасывание: падение hp → .externalVelocity от ближайшего источника.
export default function knockback(node, config, $) {
    let last = node.hp();
    return $.updateFor(node, (dt, self) => {
        const hp = self.hp();
        if (hp < last) {
            const src = self.closest ? self.closest(config.source) : $(config.source).first();
            const p = self.pos(), q = src && src.length ? src.pos() : { x: p.x - 1, y: p.y };
            const dx = p.x - q.x, dy = p.y - q.y, l = Math.hypot(dx, dy) || 1;
            self.externalVelocity(dx / l * config.force, dy / l * config.force, config.decay);
        }
        last = hp;
    });
}
