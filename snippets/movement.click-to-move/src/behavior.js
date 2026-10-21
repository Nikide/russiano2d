// Клик → цель в мире; движение до радиуса прибытия, затем событие arrived.
export default function clickToMove(node, config, $) {
    let target = null;
    return $.updateFor(node, (dt, self) => {
        if ($.input.mousePressed(config.button)) target = $.input.mouseWorld();
        if (!target) return;
        const p = self.pos();
        if (Math.hypot(target.x - p.x, target.y - p.y) <= config.reach) { target = null; self.velocity(0, 0); self.emit('arrived', {}); return; }
        self.moveTowards(target, config.speed);
    });
}
