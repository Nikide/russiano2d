
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

export default function rocket(node, config, $) {
    const aim = aimTracker($);
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        const dir = aim();
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        cd = config.cooldown;
        const p0 = self.pos();
        let ang = Math.atan2(dir.y, dir.x), life = 4000;
        const r = $('<rocket>').at(p0.x, p0.y).size(10, 4).appendTo($.world);
        $.updateFor(r, (d, me) => {
            const p = me.pos();
            const target = $(config.targets).nodes.reduce((best, n) => {
                const q = $(n).pos(), dd = Math.hypot(q.x - p.x, q.y - p.y);
                return !best || dd < best.d ? { n, d: dd, q } : best;
            }, null);
            if (target) {
                const want = Math.atan2(target.q.y - p.y, target.q.x - p.x);
                let diff = Math.atan2(Math.sin(want - ang), Math.cos(want - ang));
                diff = Math.max(-config.turn * d, Math.min(config.turn * d, diff));
                ang += diff;
            }
            me.at(p.x + Math.cos(ang) * config.speed * d, p.y + Math.sin(ang) * config.speed * d).angle(ang * 180 / Math.PI);
            life -= d * 1000;
            const close = target && target.d < 10;
            if (close || life <= 0) { explode($, me.pos(), config.radius, config.damage, config.targets, self); me.remove(); }
        });
    });
}
