
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function replicateInventory(node, config, $) {
    const id = node.attr('id');
    const handle = (data, peerId) => {
        if (!$.net.isAuthority() || !data || data.id !== id) return;
        const bag = bagOf(node);
        if (!bag || !$.items.has(data.item)) return;
        if (data.op === 'add') bag.add(data.item, data.count || 1); else if (data.op === 'remove') bag.remove(data.item, data.count || 1);
        $.net.broadcast('inv:snapshot', { id, bag: bag.save() }, { delivery: 'reliable' });
    };
    const snap = (data) => { if (data && data.id === id && !$.net.isAuthority()) { const bag = bagOf(node); if (bag) bag.load(data.bag); node.emit('inv:changed', {}); } };
    $.net.on('inv:request', handle);
    $.net.on('inv:snapshot', snap);
    return () => { $.net.off('inv:request', handle); $.net.off('inv:snapshot', snap); };
}
