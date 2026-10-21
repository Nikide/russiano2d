// Автоогонь: пока клавиша зажата — выстрел каждый раз, когда темп ствола позволяет.
// У weapon.base очистите fireKey, чтобы стрелял только этот пакет.
export default function auto(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const gun = $.weapons.of(self);
        if (!gun || !$.input.down(config.key)) return;
        const shot = gun.fire({ again: true });
        if (shot.fired) self.emit('weapon:fire', { damage: shot.damage, spread: shot.spread, pellets: shot.pellets, falloff: shot.falloff });
        else if (shot.reason === 'empty') self.emit('weapon:reload-request', { auto: true });
    });
}
