// Лифт: целевой этаж; актор на платформе стрелками выбирает соседний.
export default function elevator(node, config, $) {
    const floors = config.floors.map(Number).filter(Number.isFinite);
    let floor = 0, target = 0;
    node.addClass('platform');
    const call = (e) => { const f = Number(e.data && e.data.floor); if (f >= 0 && f < floors.length) target = f; };
    node.on('elevator:call', call);
    const stop = $.updateFor(node, (dt, self) => {
        if (!floors.length) return;
        const who = $(config.actor);
        const riding = who.length && self.overlaps(who) || who.length && Math.abs(who.pos().x - self.pos().x) < self.width() / 2 && Math.abs(who.pos().y + who.height() / 2 - (self.pos().y - self.height() / 2)) < 6;
        if (riding && floor === target) {
            if ($.input.pressed(config.up) && target < floors.length - 1) target++;
            if ($.input.pressed(config.down) && target > 0) target--;
        }
        const p = self.pos(), y = floors[target], step = config.speed * dt;
        if (Math.abs(y - p.y) <= step) { if (floor !== target) { floor = target; self.at(p.x, y).emit('elevator:arrived', { floor }); } return; }
        self.at(p.x, p.y + Math.sign(y - p.y) * step);
    });
    return () => { stop(); node.off('elevator:call', call); };
}
