// Транспорт: водитель скрывается и выключается; транспорт едет от ввода; выход — обратно.
export default function vehicleSeat(node, config, $) {
    let seated = false;
    return $.updateFor(node, (dt, self) => {
        const d = $(config.driver);
        if (!d.length) return;
        if ($.input.pressed(config.key)) {
            if (!seated && self.distanceTo(d) <= config.radius) { seated = true; d.hide().active(false); self.emit('vehicle:enter', { driver: d }); return; }
            if (seated) { seated = false; const p = self.pos(); d.at(p.x, p.y - self.height()).show().active(true); self.velocity(0, 0); self.emit('vehicle:exit', { driver: d }); return; }
        }
        if (!seated) return;
        const v = $.input.vec('wasd');
        self.velocity(v.x * config.speed, v.y * config.speed);
    });
}
