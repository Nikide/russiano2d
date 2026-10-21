
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function weaponSlot(node, config, $) {
    const give = (id) => { if (id && $.weapons.has(id)) { $.weapons.give(node, id); node.data('weapon', id).emit('weapon:equipped', { weapon: id }); return true; } return false; };
    const on = (e) => {
        const item = e.data && e.data.item, def = item && $.items.get(item), bag = bagOf(node);
        if (!def || def.kind !== 'weapon' || (bag && !bag.has(item))) { node.emit('equip:denied', { item }); return; }
        if (!give(def.weapon || item)) node.emit('equip:denied', { item });
    };
    node.on('equip-weapon', on);
    give(config.defaultWeapon);
    return () => node.off('equip-weapon', on);
}
