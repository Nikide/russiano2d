
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function inventoryWeight(node, config, $) {
    let over = false;
    return $.updateFor(node, (dt, self) => {
        const bag = bagOf(self);
        if (!bag) return;
        const limit = bag.carryLimit();
        self.data('load', limit > 0 ? bag.mass() / limit : 0);
        const now = bag.overloaded();
        if (now !== over) { over = now; self.data('overloaded', over).emit(over ? 'overloaded' : 'unloaded', {}); }
        if (over) { const v = self.velocity(); self.velocity(v.x * (1 - config.slow), v.y); }
    });
}
