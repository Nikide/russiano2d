
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function lootPickup(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (!$.input.pressed(config.key)) return;
        const mine = bagOf(self);
        if (!mine) return;
        $(config.containers).each((i, c) => {
            const theirs = bagOf(c);
            if (!theirs || self.distanceTo(c) > config.radius) return;
            let moved = 0;
            for (const [id, n] of Object.entries(theirs.summary())) { const put = mine.add(id, n); theirs.remove(id, put); moved += put; }
            if (moved) { self.emit('inv:changed', {}); self.emit('loot', { from: c, count: moved }); }
        });
    });
}
