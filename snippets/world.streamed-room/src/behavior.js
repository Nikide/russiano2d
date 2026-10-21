// Комната: .active(false) для её сущностей вне прямоугольника узла + margin.
export default function streamedRoom(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let on = null;
    return $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
        if (!p.length) return;
        const c = self.pos(), q = p.pos();
        const now = Math.abs(q.x - c.x) <= self.width() / 2 + config.margin && Math.abs(q.y - c.y) <= self.height() / 2 + config.margin;
        if (now === on) return;
        on = now;
        $(config.members).active(on);
        $.emit(on ? 'room:enter' : 'room:leave', { room: self.attr('id') });
    });
}
