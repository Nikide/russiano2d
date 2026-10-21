
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function equipmentArmor(node, config, $) {
    return node.damageFilter((info) => {
        const bag = bagOf(node);
        const cls = bag ? bag.armorClass() : 0;
        return info.amount <= 0 ? 0 : Math.max(config.minimum, info.amount - cls * config.perClass);
    });
}
