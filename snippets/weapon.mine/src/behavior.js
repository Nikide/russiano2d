
// Взрыв: урон всем целям в радиусе с убыванием к краю.
function explode($, at, radius, damage, targets, by) {
    const hits = $.world.query(at.x, at.y, radius).nodes.filter((n) => $(n).is(targets));
    for (const n of hits) {
        const p = $(n).pos(), d = Math.hypot(p.x - at.x, p.y - at.y);
        $(n).damage(Math.round(damage * Math.max(0.25, 1 - d / radius)), by, 'explosion');
    }
    $.emit('explosion', { x: at.x, y: at.y, radius, hits: hits.length });
    return hits.length;
}

export default function mine(node, config, $) {
    const placed = [];
    return $.updateFor(node, (dt, self) => {
        if (!$.input.pressed(config.key)) return;
        while (placed.length && placed[0].get(0).removed) placed.shift();
        if (placed.length >= config.max) return;
        const p = self.pos();
        const m = $('<mine>').at(p.x, p.y).size(10, 6).appendTo($.world);
        placed.push(m);
        let arm = config.arm;
        $.updateFor(m, (d, me) => {
            if (arm > 0) { arm -= d * 1000; return; }
            const q = me.pos();
            if (!$.world.query(q.x, q.y, config.trigger).nodes.some((n) => $(n).is(config.targets))) return;
            explode($, q, config.radius, config.damage, config.targets, self);
            me.remove();
        });
    });
}
