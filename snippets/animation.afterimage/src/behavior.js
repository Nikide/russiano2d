// Следы: копии узла (sprite + кадр) гаснут за 200 мс.
export default function afterimage(node, config, $) {
    let left = 0, t = 0;
    const on = () => { left = config.duration; };
    for (const ev of config.events) node.on(ev, on);
    const stop = $.updateFor(node, (dt, self) => {
        if (left <= 0) return;
        left -= dt * 1000; t -= dt * 1000;
        if (t > 0) return;
        t = config.every;
        const p = self.pos(), raw = self.get(0);
        const ghost = $('<afterimage>').at(p.x, p.y).size(self.width(), self.height()).color(config.color).alpha(0.5).appendTo($.world);
        if (raw.attrs && raw.attrs.src) ghost.sprite(raw.attrs.src);
        ghost.fadeTo(0, 200).then(() => ghost.remove());
    });
    return () => { stop(); for (const ev of config.events) node.off(ev, on); };
}
