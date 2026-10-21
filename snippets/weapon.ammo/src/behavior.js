// Запас: weapon.base шлёт weapon:reload-request — заряжаем не больше, чем есть.
export default function ammo(node, config, $) {
    let reserve = config.reserve, lastMag = null;
    node.data('ammoReserveManaged', true).data('ammoReserve', reserve);
    const onReload = () => {
        const gun = $.weapons.of(node);
        if (!gun || reserve <= 0) { node.emit('ammo:empty', {}); return; }
        gun.reload(reserve);
    };
    const onAmmo = (e) => { reserve = Math.min(config.max, reserve + (e.data && e.data.count || 0)); node.data('ammoReserve', reserve); };
    node.on('weapon:reload-request', onReload);
    node.on('ammo', onAmmo);
    const stop = $.updateFor(node, (dt, self) => {
        const gun = $.weapons.of(self);
        if (!gun) return;
        const mag = gun.magazine;
        if (lastMag !== null && mag > lastMag) { reserve = Math.max(0, reserve - (mag - lastMag)); self.data('ammoReserve', reserve); }
        lastMag = mag;
    });
    return () => { stop(); node.off('weapon:reload-request', onReload); node.off('ammo', onAmmo); node.data('ammoReserveManaged', false); };
}
