// Зона: акустика по прямоугольнику узла; музыка при входе игрока.
export default function audioZone(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const id = 'zone_' + (node.attr('id') || 'snippet');
    const p0 = node.pos();
    $.audio.zone(id, { rect: [p0.x - node.width() / 2, p0.y - node.height() / 2, node.width(), node.height()], height: config.height, material: config.material });
    let inside = false;
    const stop = $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        if (config.music) { if (inside) $.audio.music(config.music); else $.audio.musicStop(); }
        $.emit(inside ? 'audio-zone:enter' : 'audio-zone:leave', { zone: id });
    });
    return () => { stop(); $.audio.removeZone(id); };
}
