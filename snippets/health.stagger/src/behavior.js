// Оглушение: damaged копит урон, спадающий со временем; порог → stagger.
export default function stagger(node, config, $) {
    let acc = 0, stun = 0;
    const on = (e) => { if (stun <= 0) acc += e.data.amount; };
    node.on('damaged', on);
    const stop = $.updateFor(node, (dt, self) => {
        if (stun > 0) {
            stun -= dt * 1000;
            self.velocity(0, self.velocity().y);
            if (stun <= 0) { self.data('staggered', false); self.emit('stagger:end', {}); }
            return;
        }
        acc = Math.max(0, acc - config.decay * dt);
        if (acc >= config.threshold) { acc = 0; stun = config.duration; self.data('staggered', true); self.emit('stagger', { ms: config.duration }); }
    });
    return () => { stop(); node.off('damaged', on); };
}
