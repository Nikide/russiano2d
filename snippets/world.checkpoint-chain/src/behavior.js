// Цепочка: индекс следующей; data('checkpoint') игрока — для health.respawn.
export default function checkpointChain(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let next = Number($.save.get(config.key)) || 0;
    return $.updateFor(node, () => {
        const pts = $(config.points).nodes.slice().sort((a, b) => (Number($(a).data('order')) || 0) - (Number($(b).data('order')) || 0) || a.x - b.x);
        const p = sel(config.player);
        if (!p.length || next >= pts.length || !p.overlaps($(pts[next]))) return;
        const c = pts[next];
        p.data('checkpoint', { x: c.x, y: c.y, id: $(c).attr('id') });
        $(c).addClass('checkpoint-active');
        next++;
        $.save.set(config.key, next);
        $.emit('checkpoint:chain', { index: next, of: pts.length });
    });
}
