// Цепь: ближайшая цель в range, затем ближайшая непоражённая в jump от предыдущей.
export default function chainLightning(node, config, $) {
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        cd = config.cooldown;
        const hit = new Set();
        let from = self.pos(), reach = config.range, dmg = config.damage;
        const path = [from];
        for (let i = 0; i < config.chains; i++) {
            let best = null;
            for (const n of $(config.targets).nodes) {
                if (hit.has(n)) continue;
                const q = $(n).pos(), d = Math.hypot(q.x - from.x, q.y - from.y);
                if (d <= reach && (!best || d < best.d)) best = { n, d, q };
            }
            if (!best) break;
            hit.add(best.n);
            $(best.n).damage(Math.round(dmg), self, 'shock');
            path.push(best.q);
            from = best.q; reach = config.jump; dmg *= config.falloff;
        }
        self.emit('chain-lightning', { path, hits: hit.size });
    });
}
