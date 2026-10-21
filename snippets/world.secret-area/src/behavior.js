// Тайник: счётчик найденных — $.save 'secrets'.
export default function secretArea(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let found = false;
    return $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
        if (found || !p.length || !self.overlaps(p)) return;
        found = true;
        if (config.cover) $(config.cover).fadeTo(0.2, 300);
        const n = (Number($.save.get('secrets')) || 0) + 1;
        $.save.set('secrets', n);
        $.emit(config.rewardEvent, { id: self.attr('id'), total: n });
    });
}
