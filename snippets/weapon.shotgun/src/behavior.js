// Дробовик: описание ствола style: 'shells' (поштучная перезарядка) и выстрел по клавише.
export default function shotgun(node, config, $) {
    if (!$.weapons.has(config.weapon)) {
        $.weapons.define({ id: config.weapon, damage: config.damage, pellets: config.pellets, spread: config.spread,
            ammo: config.shells, reload: config.reload, rpm: 70, style: 'shells', modes: ['single'] });
    }
    const gun = $.weapons.give(node, config.weapon);
    if (!gun) return () => {};
    return $.updateFor(node, (dt, self) => {
        gun.tick(dt);
        if (!$.input.pressed(config.key)) return;
        const shot = gun.fire({ again: true });
        if (shot.fired) self.emit('weapon:fire', { damage: shot.damage, spread: shot.spread, pellets: shot.pellets, falloff: shot.falloff });
        else if (shot.reason === 'empty') gun.reload();
    });
}
