
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function consumable(node, config, $) {
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$.input.pressed(config.key)) return;
        const bag = bagOf(self);
        if (!bag) return;
        const active = self.data('activeItem');
        const pick = [active, ...Object.keys(bag.summary())].find((id) => {
            const d = id && $.items.get(id);
            return d && bag.has(id) && config.kinds.includes(d.kind);
        });
        if (!pick) { self.emit('consume:none', {}); return; }
        const def = $.items.get(pick);
        bag.remove(pick, 1);
        if (def.heal) self.heal(def.heal);
        cd = config.cooldown;
        self.emit('consumed', { item: pick, heal: def.heal || 0 });
        self.emit('inv:changed', {});
    });
}
