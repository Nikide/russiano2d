
// Направление прицела: последний ненулевой ввод (wasd/стрелки), иначе по flip.
function aimTracker(node, $) {
    let ax = 1, ay = 0;
    return () => {
        const v = $.input.vec('wasd');
        const w = v.x || v.y ? v : $.input.vec('arrows');
        if (w.x || w.y) { const l = Math.hypot(w.x, w.y); ax = w.x / l; ay = w.y / l; }
        return { x: ax, y: ay };
    };
}

export default function melee(node, config, $) {
    const aim = aimTracker(node, $);
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        const dir = aim();
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        cd = config.cooldown;
        const p = self.pos(), cx = p.x + dir.x * config.reach, cy = p.y + dir.y * config.reach;
        const hits = $.world.query(cx, cy, config.radius).nodes.filter((n) => n !== self.get(0) &&
            (config.targets ? $(n).is(config.targets) : $(n).hp() > 0));
        for (const n of hits) $(n).damage(config.damage);
        self.emit('melee', { hits: hits.length, x: cx, y: cy });
    });
}
