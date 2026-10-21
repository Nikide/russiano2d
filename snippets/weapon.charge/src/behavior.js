// Заряд: время удержания → множитель по порогам; выстрел при отпускании.
function parseLevels(list) {
    return list.map((s) => s.split('=').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite))
        .sort((a, b) => a[0] - b[0]);
}

export default function charge(node, config, $) {
    const levels = parseLevels(config.levels);
    let held = 0;
    return $.updateFor(node, (dt, self) => {
        const gun = $.weapons.of(self);
        if (!gun) return;
        if ($.input.down(config.key)) { held += dt * 1000; self.data('charge', held); return; }
        if (held <= 0) return;
        const t = held;
        held = 0;
        self.data('charge', 0);
        if (t < config.min) return;
        let mul = 1;
        for (const [ms, m] of levels) if (t >= ms) mul = m;
        const shot = gun.fire({ again: true });
        if (shot.fired) self.emit('weapon:fire', { damage: shot.damage * mul, spread: shot.spread, pellets: shot.pellets, falloff: shot.falloff, charge: t, multiplier: mul });
    });
}
