// Зона: акустика по прямоугольнику узла; музыка при входе игрока.
export default function audioZone(node, config, $) {
    const id = 'zone_' + (node.attr('id') || 'snippet');
    const p0 = node.pos();
    $.audio.zone(id, { rect: [p0.x - node.width() / 2, p0.y - node.height() / 2, node.width(), node.height()], height: config.height, material: config.material });
    let inside = false;
    const stop = $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        if (config.music) { if (inside) $.audio.music(config.music); else $.audio.musicStop(); }
        $.emit(inside ? 'audio-zone:enter' : 'audio-zone:leave', { zone: id });
    });
    return () => { stop(); $.audio.removeZone(id); };
}
