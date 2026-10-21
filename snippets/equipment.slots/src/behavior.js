
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function equipmentSlots(node, config, $) {
    const equip = (e) => {
        const bag = bagOf(node), id = e.data && e.data.item, def = id && $.items.get(id);
        if (!bag || !def || !def.wear || !config.allowed.includes(def.wear)) { node.emit('equip:denied', { item: id }); return; }
        const worn = bag.wear(id);
        node.emit(worn ? 'equipped' : 'equip:denied', { item: id, slot: def.wear });
    };
    const unequip = (e) => { const bag = bagOf(node); if (bag && e.data && bag.unwear(e.data.slot)) node.emit('unequipped', { slot: e.data.slot }); };
    node.on('equip', equip);
    node.on('unequip', unequip);
    return () => { node.off('equip', equip); node.off('unequip', unequip); };
}
