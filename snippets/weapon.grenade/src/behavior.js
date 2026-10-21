
// Направление прицела: последний ненулевой ввод (wasd/стрелки), иначе вправо.
function aimTracker($) {
    let ax = 1, ay = 0;
    return () => {
        const v = $.input.vec('wasd');
        const w = v.x || v.y ? v : $.input.vec('arrows');
        if (w.x || w.y) { const l = Math.hypot(w.x, w.y); ax = w.x / l; ay = w.y / l; }
        return { x: ax, y: ay };
    };
}

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

export default function grenade(node, config, $) {
    const aim = aimTracker($);
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        const dir = aim();
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        cd = config.cooldown;
        const p = self.pos(), sx = dir.x >= 0 ? 1 : -1;
        // Упругость тела — атрибут restitution до создания тела (отскоки гранаты).
        const g = $('<grenade>', { restitution: 0.5 }).at(p.x + sx * 10, p.y - 10).size(8, 8).body('dynamic').appendTo($.world);
        g.velocity(sx * config.throw[0], -config.throw[1]);
        let fuse = config.fuse;
        $.updateFor(g, (d, me) => {
            fuse -= d * 1000;
            if (fuse > 0) return;
            explode($, me.pos(), config.radius, config.damage, config.targets, self);
            me.remove();
        });
    });
}
