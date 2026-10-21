// Опасность: раз в interval — урон каждому пересекающему.
export default function hazard(node, config, $) {
    let t = 0;
    return $.updateFor(node, (dt, self) => {
        t -= dt * 1000;
        if (t > 0) return;
        let hit = 0;
        $(config.targets).each((i, w) => { if (self.overlaps(w)) { w.damage(config.damage, self, config.type); hit++; } });
        if (hit) t = config.interval;
    });
}
