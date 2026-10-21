// Перенос: взятый ящик без гравитации следует перед актором (по взгляду).
export default function movableCrate(node, config, $) {
    let held = false;
    node.addClass('crate');
    return $.updateFor(node, (dt, self) => {
        const who = $(config.actor);
        if (!who.length) return;
        if ($.input.pressed(config.key) && (held || self.distanceTo(who) <= config.radius)) {
            held = !held;
            self.gravity(!held);
            self.emit(held ? 'crate:grab' : 'crate:drop', {});
        }
        if (!held) return;
        const q = who.pos(), dir = who.flip().x ? -1 : 1;
        self.at(q.x + dir * config.offset, q.y - who.height() / 4).velocity(0, 0);
    });
}
