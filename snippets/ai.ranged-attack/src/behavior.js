// Дальний бой: коридор дистанции [min, max], выстрел снарядом в цель.
export default function rangedAttack(node, config, $) {
    let cd = config.cooldown;
    return $.updateFor(node, (dt, self) => {
        const tg = $(config.target);
        if (!tg.length || !tg.alive()) return;
        const p = self.pos(), q = tg.pos(), dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d > config.max) self.moveTowards(tg, config.speed);
        else if (d < config.min) self.velocity(-dx / d * config.speed, -dy / d * config.speed);
        else self.velocity(0, self.velocity().y);
        cd -= dt * 1000;
        if (cd > 0 || d > config.max * 1.5) return;
        cd = config.cooldown;
        const vx = dx / d * config.bulletSpeed, vy = dy / d * config.bulletSpeed;
        const b = $('<bullet>', { class: 'enemy-bullet' }).at(p.x, p.y).size(5, 5).appendTo($.world);
        let life = 3000;
        $.updateFor(b, (s, me) => {
            const c = me.pos();
            me.at(c.x + vx * s, c.y + vy * s);
            life -= s * 1000;
            if (me.overlaps(tg)) { tg.damage(config.damage, self, 'ballistic'); me.remove(); } else if (life <= 0) me.remove();
        });
        self.emit('shoot', { target: tg });
    });
}
