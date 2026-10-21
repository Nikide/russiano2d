// Приказ: move — к точке, hold — стоять, follow — за лидером; хранится в data('order').
export default function squadOrder(node, config, $) {
    let order = { kind: 'hold' };
    const on = (e) => { order = e.data || order; node.data('order', order.kind); };
    node.on('squad:order', on);
    const stop = $.updateFor(node, (dt, self) => {
        if (order.kind === 'move' && Number.isFinite(order.x)) {
            const p = self.pos();
            if (Math.hypot(order.x - p.x, order.y - p.y) > 4) self.moveTowards(order, config.speed);
            else { order = { kind: 'hold' }; self.emit('squad:arrived', {}); }
        } else if (order.kind === 'follow') {
            const l = $(config.leader);
            if (l.length && self.distanceTo(l) > 40) self.moveTowards(l, config.speed);
        } else self.velocity(0, self.velocity().y);
    });
    return () => { stop(); node.off('squad:order', on); };
}
