
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

export default function areaDenial(node, config, $) {
    const aim = aimTracker($);
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        const dir = aim();
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        cd = config.cooldown;
        const p = self.pos();
        const z = $('<hazard>').at(p.x + dir.x * 48, p.y + dir.y * 48).size(config.size[0], config.size[1]).color('#ff6020').alpha(0.4).appendTo($.world);
        let left = config.duration;
        const carry = new Map();
        $.updateFor(z, (d, me) => {
            left -= d * 1000;
            if (left <= 0) { me.remove(); return; }
            $(config.targets).each((i, t) => {
                if (!me.overlaps(t)) return;
                const n = t.get(0), c = (carry.get(n) || 0) + config.dps * d;
                if (c >= 1) { t.damage(Math.floor(c), self, 'fire'); carry.set(n, c - Math.floor(c)); } else carry.set(n, c);
            });
        });
    });
}
