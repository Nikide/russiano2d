// Заморозка: ice копит холод; порог — 0 скорости на время; fire — оттаивание.
export default function freeze(node, config, $) {
    let cold = 0, frozen = 0;
    const on = (e) => {
        if (e.data.type === 'ice') cold += e.data.amount;
        if (e.data.type === 'fire' && (frozen > 0 || cold > 0)) { frozen = 0; cold = 0; node.data('frozen', false); node.emit('thaw', {}); }
    };
    node.on('damaged', on);
    const stop = $.updateFor(node, (dt, self) => {
        if (frozen > 0) {
            frozen -= dt * 1000;
            self.velocity(0, 0);
            if (frozen <= 0) { cold = 0; self.data('frozen', false); self.emit('thaw', {}); }
            return;
        }
        if (cold >= config.threshold) { frozen = config.duration; self.data('frozen', true); self.emit('freeze', {}); return; }
        if (cold > 0) { const v = self.velocity(); self.velocity(v.x * (1 - config.slow * cold / config.threshold), v.y); }
    });
    return () => { stop(); node.off('damaged', on); };
}
