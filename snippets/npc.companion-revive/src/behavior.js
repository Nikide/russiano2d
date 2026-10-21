// Спасение: игрок мёртв → бежать к нему, рядом копить время; data('reviveLeft').
export default function companionRevive(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let left = config.uses, t = 0;
    node.data('reviveLeft', left);
    return $.updateFor(node, (dt, self) => {
        const pl = sel(config.player);
        if (!pl.length || pl.alive() || left <= 0) { t = 0; return; }
        if (self.distanceTo(pl) > 20) { self.moveTowards(pl, config.speed); return; }
        t += dt * 1000;
        if (t < config.time) return;
        t = 0; left--;
        pl.hp(config.hp);
        self.data('reviveLeft', left).emit('companion:revived', { player: pl });
    });
}
