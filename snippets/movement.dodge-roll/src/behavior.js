// Перекат: рывок + .invulnerable на окно iframes.
export default function dodgeRoll(node, config, $) {
    let active = 0, cd = 0, dx = 1, dy = 0;
    return $.updateFor(node, (dt, self) => {
        const ms = dt * 1000;
        if (cd > 0) cd -= ms;
        const v = $.input.vec('wasd');
        if (v.x || v.y) { const l = Math.hypot(v.x, v.y); dx = v.x / l; dy = v.y / l; }
        if (active <= 0 && cd <= 0 && $.input.pressed(config.key)) {
            active = config.duration; cd = config.cooldown + config.duration;
            if (config.iframes > 0) self.invulnerable(config.iframes);
            self.emit('roll', { dx, dy });
        }
        if (active > 0) { active -= ms; self.velocity(dx * config.speed, dy * config.speed); }
    });
}
