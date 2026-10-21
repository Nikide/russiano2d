// Оружие: описание ствола в $.weapons (если его ещё нет), ствол в руках узла,
// выстрел по клавише. Попадание считают weapon.hitscan / weapon.projectile /
// игра по событию 'weapon:fire' — сам ствол пулю не пускает ($.weapons §7).
export default function weaponBase(node, config, $) {
    if (!$.weapons.has(config.weapon)) {
        $.weapons.define({ id: config.weapon, damage: config.damage, rpm: config.rpm, ammo: config.ammo,
            reload: config.reload, spread: config.spread, pellets: config.pellets, falloff: config.falloff,
            modes: [config.mode] });
    }
    const gun = $.weapons.give(node, config.weapon);
    if (!gun) return () => {};
    return $.updateFor(node, (dt, self) => {
        gun.tick(dt);
        if ($.input.pressed(config.reloadKey)) gun.reload();
        const held = $.input.down(config.fireKey);
        if (!held) return;
        const shot = gun.fire({ held: !$.input.pressed(config.fireKey) });
        if (shot.fired) {
            if (config.sound) $.sound.play(config.sound);
            self.emit('weapon:fire', { damage: shot.damage, spread: shot.spread, pellets: shot.pellets, falloff: config.falloff });
        } else if (shot.reason === 'empty') {
            gun.reload();
        }
    });
}
