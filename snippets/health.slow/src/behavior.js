// Замедление: масштаб горизонтальной (и в top-down — вертикальной) скорости на время.
export default function slow(node, config, $) {
    let left = 0, factor = 1;
    const on = (e) => { if (e.data && e.data.kind === 'slow') { factor = e.data.factor ?? config.factor; left = e.data.ms ?? config.duration; node.data('slow', factor); } };
    node.on('status', on);
    const stop = $.updateFor(node, (dt, self) => {
        if (left <= 0) return;
        left -= dt * 1000;
        const v = self.velocity();
        self.velocity(v.x * factor, self.gravity && self.onFloor() !== undefined && Math.abs(v.y) > 0 && !self.onFloor() ? v.y : v.y * factor);
        if (left <= 0) { factor = 1; self.data('slow', 1); self.emit('slow:end', {}); }
    });
    return () => { stop(); node.off('status', on); };
}
