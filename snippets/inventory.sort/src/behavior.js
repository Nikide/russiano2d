
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function inventorySort(node, config, $) {
    const sort = () => {
        const bag = bagOf(node);
        if (!bag) return;
        if (config.by === 'value') bag.sortByValue();
        else {
            const all = Object.entries(bag.summary());
            const key = (id) => { const d = $.items.get(id) || {}; return config.by === 'kind' ? (d.kind || '') + (d.title || id) : (d.title || id); };
            all.sort((a, b) => key(a[0]).localeCompare(key(b[0])));
            for (const [id, n] of all) bag.remove(id, n);
            for (const [id, n] of all) bag.add(id, n);
        }
        node.emit('inv:changed', { sorted: config.by });
    };
    node.on('inv:sort', sort);
    const stop = $.updateFor(node, () => { if ($.input.pressed(config.key)) sort(); });
    return () => { stop(); node.off('inv:sort', sort); };
}
