// Зона: у тела внутри выключается общая гравитация и добавляется своя.
export default function gravityZone(node, config, $) {
    const inside = new Set();
    const stop = $.updateFor(node, (dt, self) => {
        $(config.affects).each((i, w) => {
            const raw = w.get(0), now = self.overlaps(w);
            if (now && !inside.has(raw)) { inside.add(raw); w.gravity(false); w.emit('gravity:enter', {}); }
            if (!now && inside.has(raw)) { inside.delete(raw); w.gravity(true); w.emit('gravity:leave', {}); }
            if (now) { const v = w.velocity(); w.velocity(v.x + config.gravity[0] * dt, v.y + config.gravity[1] * dt); }
        });
    });
    return () => { stop(); for (const raw of inside) if (!raw.removed) $(raw).gravity(true); };
}
