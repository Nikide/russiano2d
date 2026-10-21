
// Рецепт: «результат=число: ингредиент=число, …»
function parseRecipe(text) {
    const [out, ins] = String(text).split(':');
    const [id, n] = (out || '').split('=');
    const need = (ins || '').split(',').map((s) => s.split('=')).filter((p) => p[0] && p[0].trim())
        .map(([k, v]) => [k.trim(), Number(v) || 1]);
    return id && id.trim() ? { id: id.trim(), count: Number(n) || 1, need } : null;
}
function canCraft(bag, r) { return r.need.every(([k, v]) => bag.count(k) >= v); }

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function craftQueue(node, config, $) {
    const queue = [];
    let t = 0;
    node.data('craftQueue', true);
    const add = (e) => {
        const { recipe: r, by } = e.data;
        const bag = bagOf(by);
        if (queue.length >= config.max || !bag || !canCraft(bag, r)) return node.emit('craft:denied', { recipe: r.id, reason: 'queue' });
        for (const [k, v] of r.need) bag.remove(k, v);
        queue.push({ r, by });
        node.data('queue', queue.map((q) => q.r.id)).emit('craft:queued', { item: r.id, position: queue.length });
    };
    node.on('craft:queue', add);
    const stop = $.updateFor(node, (dt, self) => {
        if (!queue.length) { t = 0; return; }
        t += dt * 1000;
        self.data('craftProgress', Math.min(1, t / config.time));
        if (t < config.time) return;
        t = 0;
        const { r, by } = queue.shift();
        const bag = bagOf(by);
        if (bag) bag.add(r.id, r.count);
        self.data('queue', queue.map((q) => q.r.id)).emit('crafted', { item: r.id, count: r.count, by });
    });
    return () => { stop(); node.off('craft:queue', add); node.data('craftQueue', false); };
}
