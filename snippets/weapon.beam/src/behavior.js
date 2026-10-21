
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

export default function beam(node, config, $) {
    const aim = aimTracker($);
    let carry = 0;
    return $.updateFor(node, (dt, self) => {
        const dir = aim();
        if (!$.input.down(config.key)) { if (carry) { carry = 0; self.emit('beam', { on: false }); } return; }
        const from = self.pos(), to = { x: from.x + dir.x * config.range, y: from.y + dir.y * config.range };
        const hit = $.world.raycastAll(from, to).find((h) => h.node && h.node !== self.get(0) && $(h.node).is(config.targets));
        self.emit('beam', { on: true, from, to: hit ? hit.point : to });
        if (!hit) return;
        carry += config.dps * dt;
        if (carry >= 1) { const n = Math.floor(carry); carry -= n; $(hit.node).damage(n, self, 'energy'); }
    });
}
