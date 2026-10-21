
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

export default function boomerang(node, config, $) {
    const aim = aimTracker($);
    let flying = null;
    return $.updateFor(node, (dt, self) => {
        const dir = aim();
        if (flying || !$.input.pressed(config.key)) return;
        const start = self.pos();
        flying = $('<boomerang>').at(start.x, start.y).size(10, 10).appendTo($.world);
        let out = true, hitOut = new Set(), hitBack = new Set();
        $.updateFor(flying, (d, b) => {
            const p = b.pos();
            if (out) {
                b.at(p.x + dir.x * config.speed * d, p.y + dir.y * config.speed * d);
                if (Math.hypot(p.x - start.x, p.y - start.y) >= config.distance) out = false;
            } else {
                const o = self.pos(), dx = o.x - p.x, dy = o.y - p.y, l = Math.hypot(dx, dy);
                if (l < 12) { b.remove(); flying = null; self.emit('boomerang:caught', {}); return; }
                b.at(p.x + dx / l * config.speed * d, p.y + dy / l * config.speed * d);
            }
            const seen = out ? hitOut : hitBack;
            for (const n of $.world.query(p.x, p.y, 8).nodes) {
                if (n === self.get(0) || seen.has(n) || !$(n).is(config.targets)) continue;
                seen.add(n);
                $(n).damage(config.damage, self, 'blunt');
            }
        });
    });
}
