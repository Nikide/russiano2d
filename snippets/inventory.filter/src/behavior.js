
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function inventoryFilter(node, config, $) {
    const update = () => {
        const bag = bagOf(node);
        if (!bag) return;
        const view = Object.entries(bag.summary()).filter(([id]) => {
            const def = $.items.get(id);
            return !config.kinds.length || (def && config.kinds.includes(def.kind));
        }).map(([id, n]) => ({ id, count: n }));
        node.data('invView', view).emit('inv:view', { items: view });
    };
    node.on('inv:changed', update);
    update();
    return () => node.off('inv:changed', update);
}
