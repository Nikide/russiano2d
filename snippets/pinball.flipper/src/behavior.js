// Флиппер: угол к up при нажатии; мяч в контакте во время подъёма — импульс вверх-от флиппера.
export default function flipper(node, config, $) {
    let a = config.rest;
    node.angle(a);
    return $.updateFor(node, (dt, self) => {
        const target = $.input.down(config.key) ? config.up : config.rest;
        const step = config.speed * dt, rising = target === config.up && a !== target;
        a = Math.abs(target - a) <= step ? target : a + Math.sign(target - a) * step;
        self.angle(a);
        if (!rising) return;
        $(config.ball).each((i, b) => {
            if (!self.overlaps(b)) return;
            const r = (a - 90) * Math.PI / 180;
            b.velocity(Math.cos(r) * config.power, Math.sin(r) * config.power);
            self.emit('flipper:hit', {});
        });
    });
}
