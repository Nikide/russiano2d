// Анимация: владелец шлёт anim { id, key, flip } с частотой; остальные применяют.
export default function replicateAnimation(node, config, $) {
    const id = node.attr('id');
    let t = 0, last = '';
    const apply = (data) => { if (!data || data.id !== id) return; node.data('animKey', data.key).flip(data.flip); };
    $.net.on('anim', apply);
    const stop = $.updateFor(node, (dt, self) => {
        if (!$.net.online()) return;
        t -= dt * 1000;
        if (t > 0) return;
        t = 1000 / config.rate;
        const key = String(self.data('animKey') || '') + '|' + self.flip().x;
        if (key === last) return;
        last = key;
        $.net.broadcast('anim', { id, key: self.data('animKey'), flip: self.flip().x }, { delivery: 'state' });
    });
    return () => { stop(); $.net.off('anim', apply); };
}
