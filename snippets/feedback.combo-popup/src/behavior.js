// Серия: data('combo'); текстовый узел над объектом.
export default function comboPopup(node, config, $) {
    let n = 0, left = 0;
    const label = $('<text>', { text: '', size: config.size }).color('#ffd040').hide().appendTo($.world);
    const hit = () => { n++; left = config.window; node.data('combo', n).emit('combo', { count: n }); if (n > 1) label.text('x' + n + '!').show(); };
    for (const ev of config.events) node.on(ev, hit);
    const stop = $.updateFor(node, (dt, self) => {
        if (left <= 0) return;
        left -= dt * 1000;
        const p = self.pos();
        label.at(p.x, p.y - self.height());
        if (left <= 0) { if (n > 1) self.emit('combo:end', { count: n }); n = 0; self.data('combo', 0); label.hide(); }
    });
    return () => { stop(); for (const ev of config.events) node.off(ev, hit); label.remove(); };
}
