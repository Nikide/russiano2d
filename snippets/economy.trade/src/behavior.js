
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function trade(node, config, $) {
    const on = (e) => {
        const d = e.data || {}, other = $(d.with), a = bagOf(node), b = bagOf(other);
        const give = d.give || {}, get = d.get || {};
        if (!a || !b) return node.emit('trade:denied', { reason: 'no-bag' });
        for (const [id, n] of Object.entries(give)) if (a.count(id) < n) return node.emit('trade:denied', { reason: 'missing', item: id });
        for (const [id, n] of Object.entries(get)) if (b.count(id) < n) return node.emit('trade:denied', { reason: 'missing', item: id });
        const value = (o) => Object.entries(o).reduce((s, [id, n]) => s + ((($.items.get(id) || {}).value) || 0) * n, 0);
        if (!config.allowUnfair && value(give) < value(get)) return node.emit('trade:denied', { reason: 'unfair' });
        for (const [id, n] of Object.entries(give)) { a.remove(id, n); b.add(id, n); }
        for (const [id, n] of Object.entries(get)) { b.remove(id, n); a.add(id, n); }
        node.emit('trade:done', { give, get }); other.emit('inv:changed', {}); node.emit('inv:changed', {});
    };
    node.on('trade', on);
    return () => node.off('trade', on);
}
