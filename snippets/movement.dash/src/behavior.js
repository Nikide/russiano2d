// Рывок: на время duration скорость задаётся рывком, затем — перезарядка.
export default function dash(node, config, $) {
    let active = 0, cooldown = 0, dx = 1, dy = 0;
    return $.updateFor(node, (dt, self) => {
        const ms = dt * 1000;
        if (cooldown > 0) cooldown -= ms;
        const v = $.input.vec(config.keys);
        if (v.x || v.y) { const l = Math.hypot(v.x, v.y); dx = v.x / l; dy = v.y / l; }
        if (active <= 0 && cooldown <= 0 && $.input.pressed(config.key)) {
            active = config.duration;
            cooldown = config.cooldown + config.duration;
            self.emit('dash', { dx, dy });
        }
        if (active > 0) {
            active -= ms;
            self.velocity(dx * config.speed, dy * config.speed);
        }
    });
}
