// Контрольная точка: health.respawn читает data('checkpoint').
export default function checkpoint(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let active = false;
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.actor);
        if (!who.length || !self.overlaps(who)) return;
        const p = self.pos(), cp = who.data('checkpoint');
        if (cp && cp.id === self.attr('id')) return;
        who.data('checkpoint', { x: p.x, y: p.y, id: self.attr('id') });
        const raw = who.get(0);
        if (config.heal && raw.max_hp > 0) who.hp(raw.max_hp);
        if (config.store) $.store.set('checkpoint', { x: p.x, y: p.y, id: self.attr('id') });
        if (!active) { active = true; self.addClass('checkpoint-active'); }
        self.emit('checkpoint', { by: who });
    });
}
