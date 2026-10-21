
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

export default function sniper(node, config, $) {
    const aim = aimTracker($);
    let cd = 0, aiming = false;
    const stop = $.updateFor(node, (dt, self) => {
        const dir = aim();
        const want = $.input.down(config.aimKey);
        if (want !== aiming) { aiming = want; $.camera.zoomTo(aiming ? config.zoom : 1, 150); self.emit('aim', { on: aiming }); }
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        cd = config.cooldown;
        const from = self.pos(), to = { x: from.x + dir.x * config.range, y: from.y + dir.y * config.range };
        const hits = $.world.raycastAll(from, to).filter((h) => h.node && h.node !== self.get(0) && $(h.node).is(config.targets)).slice(0, config.pierce);
        hits.forEach((h, i) => $(h.node).damage(Math.round(config.damage * Math.pow(0.7, i)), self, 'ballistic'));
        self.emit('weapon:fire', { damage: config.damage, hits: hits.length });
    });
    return () => { stop(); if (aiming) $.camera.zoom(1); };
}
