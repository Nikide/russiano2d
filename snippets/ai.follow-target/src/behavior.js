// Следование: идёт к цели, пока дальше distance.
export default function followTarget(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        if (!sel(config.target).length) return;
        if (self.distanceTo(config.target) > config.distance) self.moveTowards(config.target, config.speed);
    });
}
