
// Направление прицела: последний ненулевой ввод (wasd/стрелки), иначе вправо.
function aimTracker(node, $) {
    let ax = 1, ay = 0;
    return () => {
        const v = $.input.vec('wasd');
        const w = v.x || v.y ? v : $.input.vec('arrows');
        if (w.x || w.y) { const l = Math.hypot(w.x, w.y); ax = w.x / l; ay = w.y / l; }
        return { x: ax, y: ay };
    };
}

export default function hitscan(node, config, $) {
    const aim = aimTracker(node, $);
    const stopAim = $.updateFor(node, () => { aim(); });
    const onFire = (e) => {
        const self = e.self, from = self.pos(), dir = aim(), shot = e.data;
        const n = Math.max(1, shot.pellets || 1);
        for (let i = 0; i < n; i++) {
            const deg = n > 1 ? (i / (n - 1) - 0.5) * shot.spread * 2 : 0;
            const a = Math.atan2(dir.y, dir.x) + deg * Math.PI / 180;
            const to = { x: from.x + Math.cos(a) * config.range, y: from.y + Math.sin(a) * config.range };
            const hit = $.world.raycastAll(from, to).find((h) => h.node && h.node !== self.get(0) &&
                (config.targets ? $(h.node).is(config.targets) : $(h.node).hp() > 0));
            if (!hit) continue;
            const dist = Math.hypot(hit.point.x - from.x, hit.point.y - from.y);
            const dmg = $.weapons.falloff(shot.damage, dist, shot.falloff || config.range);
            $(hit.node).damage(dmg);
            self.emit('weapon:hit', { target: $(hit.node), damage: dmg, point: hit.point });
        }
    };
    node.on('weapon:fire', onFire);
    return () => { node.off('weapon:fire', onFire); stopAim(); };
}
