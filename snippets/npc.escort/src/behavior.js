// Сопровождение: следование; успех — пересечение destination; провал — смерть.
export default function escort(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let done = false;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        if (self.get(0).max_hp > 0 && self.hp() <= 0) { done = true; $.emit('escort:failed', { npc: self.attr('id') }); return; }
        if ($(config.destination).some((i, z) => self.overlaps(z))) { done = true; self.velocity(0, 0); $.emit('escort:done', { npc: self.attr('id') }); return; }
        const pl = sel(config.player);
        if (pl.length && self.distanceTo(pl) > config.distance) self.moveTowards(pl, config.speed);
    });
}
