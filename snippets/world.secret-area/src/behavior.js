// Тайник: счётчик найденных — $.save 'secrets'.
export default function secretArea(node, config, $) {
    let found = false;
    return $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        if (found || !p.length || !self.overlaps(p)) return;
        found = true;
        if (config.cover) $(config.cover).fadeTo(0.2, 300);
        const n = (Number($.save.get('secrets')) || 0) + 1;
        $.save.set('secrets', n);
        $.emit(config.rewardEvent, { id: self.attr('id'), total: n });
    });
}
