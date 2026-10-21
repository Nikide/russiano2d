// Комната: .active(false) для её сущностей вне прямоугольника узла + margin.
export default function streamedRoom(node, config, $) {
    let on = null;
    return $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        if (!p.length) return;
        const c = self.pos(), q = p.pos();
        const now = Math.abs(q.x - c.x) <= self.width() / 2 + config.margin && Math.abs(q.y - c.y) <= self.height() / 2 + config.margin;
        if (now === on) return;
        on = now;
        $(config.members).active(on);
        $.emit(on ? 'room:enter' : 'room:leave', { room: self.attr('id') });
    });
}
