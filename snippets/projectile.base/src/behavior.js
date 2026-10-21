// Снаряд: свой ход по кадрам без тела; попадание — пересечение прямоугольников.
export default function projectileBase(node, config, $) {
    let life = config.lifetime;
    const hit = new Set();
    return $.updateFor(node, (dt, self) => {
        const p = self.pos();
        self.at(p.x + config.velocity[0] * dt, p.y + config.velocity[1] * dt);
        life -= dt * 1000;
        if (life <= 0) { self.remove(); return; }
        $(config.targets).each((i, t) => {
            if (hit.has(t.get(0)) || !self.overlaps(t)) return;
            hit.add(t.get(0));
            t.damage(config.damage);
            self.emit('projectile:hit', { target: t });
            if (!config.pierce) self.remove();
        });
    });
}
