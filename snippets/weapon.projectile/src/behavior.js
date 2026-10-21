
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

export default function projectile(node, config, $) {
    const aim = aimTracker(node, $);
    const stopAim = $.updateFor(node, () => { aim(); });
    const onFire = (e) => {
        const self = e.self, from = self.pos(), dir = aim(), shot = e.data;
        const b = $('<bullet>').at(from.x + dir.x * 12, from.y + dir.y * 12).size(config.size, config.size).appendTo($.world);
        if (config.sprite) b.sprite(config.sprite);
        let life = config.lifetime;
        $.updateFor(b, (dt, me) => {
            const p = me.pos();
            me.at(p.x + dir.x * config.speed * dt, p.y + dir.y * config.speed * dt);
            life -= dt * 1000;
            const hit = $.world.query(p.x, p.y, config.size).nodes.find((n) => n !== me.get(0) && n !== self.get(0) &&
                (config.targets ? $(n).is(config.targets) : $(n).hp() > 0));
            if (hit) { $(hit).damage(shot.damage); self.emit('weapon:hit', { target: $(hit), damage: shot.damage, point: p }); me.remove(); }
            else if (life <= 0) me.remove();
        });
    };
    node.on('weapon:fire', onFire);
    return () => { node.off('weapon:fire', onFire); stopAim(); };
}
