// Портал: один раз за касание; spawn для следующей сцены — в $.store.
export default function portal(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let inside = false;
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.actor);
        const now = who.length && self.overlaps(who);
        if (now && !inside && config.scene) {
            if (config.spawn) $.store.set('spawn', config.spawn);
            self.emit('portal', { scene: config.scene });
            $.scene.load(config.scene);
        }
        inside = !!now;
    });
}
