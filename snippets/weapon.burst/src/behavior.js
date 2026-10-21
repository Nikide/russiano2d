// Очередь: shots выстрелов через interval мс; темп ствола тоже соблюдается.
export default function burst(node, config, $) {
    let left = 0, wait = 0;
    return $.updateFor(node, (dt, self) => {
        const gun = $.weapons.of(self);
        if (!gun) return;
        if (left <= 0 && $.input.pressed(config.key)) { left = config.shots; wait = 0; }
        if (left <= 0) return;
        wait -= dt * 1000;
        if (wait > 0) return;
        const shot = gun.fire({ again: true });
        if (shot.fired) { left--; wait = config.interval; self.emit('weapon:fire', { damage: shot.damage, spread: shot.spread, pellets: shot.pellets, falloff: shot.falloff }); }
        else if (shot.reason === 'empty') { left = 0; self.emit('weapon:reload-request', { auto: true }); }
    });
}
