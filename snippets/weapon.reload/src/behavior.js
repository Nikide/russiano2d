// Перезарядка: запрос через weapon:reload-request (учитывает weapon.ammo), отмена — cancelReload.
export default function reload(node, config, $) {
    let empty = 0;
    return $.updateFor(node, (dt, self) => {
        const gun = $.weapons.of(self);
        if (!gun) return;
        if ($.input.pressed(config.key)) self.emit('weapon:reload-request', {});
        if ($.input.pressed(config.cancelKey) && gun.cancelReload()) self.emit('weapon:reload-cancel', {});
        if (gun.magazine > 0) { empty = 0; return; }
        empty += dt * 1000;
        if (empty >= config.autoDelay && empty - dt * 1000 < config.autoDelay) self.emit('weapon:reload-request', { auto: true });
    });
}
