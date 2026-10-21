
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function durability(node, config, $) {
    const wear = node.data('durability') || {};
    node.data('durability', wear);
    const worn = () => { const bag = bagOf(node); const w = bag ? bag.wornList() : []; const it = w.find((x) => (x.slot || ($.items.get(x.id) || {}).wear) === config.wearSlot); return it ? it.id : null; };
    const onHit = (e) => {
        const id = worn();
        if (!id || !(e.data.amount > 0)) return;
        const def = $.items.get(id) || {};
        if (wear[id] === undefined) wear[id] = def.durability || 100;
        wear[id] = Math.max(0, wear[id] - config.perHit);
        node.data('durability', wear);
        if (wear[id] <= 0) { bagOf(node).unwear(config.wearSlot); node.emit('item:broken', { item: id }); }
    };
    const onRepair = (e) => { const d = e.data || {}; if (d.item && wear[d.item] !== undefined) { wear[d.item] = ($.items.get(d.item) || {}).durability || 100; node.data('durability', wear).emit('item:repaired', { item: d.item }); } };
    node.on('damaged', onHit);
    node.on('repair', onRepair);
    return () => { node.off('damaged', onHit); node.off('repair', onRepair); };
}
