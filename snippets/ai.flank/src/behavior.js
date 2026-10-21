// Фланг: точка перпендикулярно «лицу» цели (flip) на distance.
export default function flank(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const tg = $(config.target);
        if (!tg.length) return;
        const q = tg.pos(), p = self.pos(), face = tg.flip().x ? -1 : 1;
        let s = config.side === 'left' ? -1 : config.side === 'right' ? 1 : (p.y < q.y ? -1 : 1);
        const spot = { x: q.x - face * config.distance * 0.3, y: q.y + s * config.distance };
        if (Math.hypot(spot.x - p.x, spot.y - p.y) > 6) self.moveTowards(spot, config.speed); else self.emit('flank:ready', {});
    });
}
