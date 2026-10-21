// Цепочка: индекс следующей; data('checkpoint') игрока — для health.respawn.
export default function checkpointChain(node, config, $) {
    let next = Number($.save.get(config.key)) || 0;
    return $.updateFor(node, () => {
        const pts = $(config.points).nodes.slice().sort((a, b) => (Number($(a).data('order')) || 0) - (Number($(b).data('order')) || 0) || a.x - b.x);
        const p = $(config.player);
        if (!p.length || next >= pts.length || !p.overlaps($(pts[next]))) return;
        const c = pts[next];
        p.data('checkpoint', { x: c.x, y: c.y, id: $(c).attr('id') });
        $(c).addClass('checkpoint-active');
        next++;
        $.save.set(config.key, next);
        $.emit('checkpoint:chain', { index: next, of: pts.length });
    });
}
