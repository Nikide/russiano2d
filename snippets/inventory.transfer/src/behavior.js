
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function inventoryTransfer(node, config, $) {
    const on = (e) => {
        const d = e.data || {}, from = bagOf(node), to = bagOf($(d.to));
        if (!from || !to || !d.item) { node.emit('inv:transfer-failed', { reason: 'no-bag' }); return; }
        const want = Math.min(d.count || 1, from.count(d.item));
        if (!want || (!config.partial && !to.fits(d.item, want))) { node.emit('inv:transfer-failed', { reason: 'no-space' }); return; }
        const put = to.add(d.item, want);
        from.remove(d.item, put);
        node.emit('inv:changed', {}); $(d.to).emit('inv:changed', {});
        node.emit('inv:transferred', { item: d.item, count: put });
    };
    node.on('inv:transfer', on);
    return () => node.off('inv:transfer', on);
}
