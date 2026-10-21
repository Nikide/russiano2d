
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

export default function spread(node, config, $) {
    const aim = aimTracker($);
    const stopAim = $.updateFor(node, () => { aim(); });
    const onFire = (e) => {
        const self = e.self, from = self.pos(), dir = aim(), base = Math.atan2(dir.y, dir.x);
        for (let i = 0; i < config.count; i++) {
            const a = base + (i / (config.count - 1) - 0.5) * config.angle * Math.PI / 180;
            const vx = Math.cos(a) * config.speed, vy = Math.sin(a) * config.speed;
            const b = $('<bullet>').at(from.x, from.y).size(4, 4).appendTo($.world);
            let life = config.lifetime;
            $.updateFor(b, (dt, me) => {
                const p = me.pos();
                me.at(p.x + vx * dt, p.y + vy * dt);
                life -= dt * 1000;
                const hit = $.world.query(p.x, p.y, 4).nodes.find((n) => n !== self.get(0) && $(n).is(config.targets));
                if (hit) { $(hit).damage(e.data.damage, self, 'ballistic'); me.remove(); } else if (life <= 0) me.remove();
            });
        }
    };
    node.on('weapon:fire', onFire);
    return () => { node.off('weapon:fire', onFire); stopAim(); };
}
