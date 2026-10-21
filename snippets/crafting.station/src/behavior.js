
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

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

export default function station(node, config, $) {
    node.addClass('interactive').data('prompt', 'Создать');
    const craft = (e) => {
        const d = e.data || {}, who = $(d.by || config.actor), bag = bagOf(who);
        const r = (node.data('recipes') || []).find((x) => x.id === d.recipe);
        const known = who.data('knownRecipes');
        if (!r || !bag || (Array.isArray(known) && node.data('requireDiscovery') && !known.includes(r.id))) return node.emit('craft:denied', { recipe: d.recipe, reason: 'unknown' });
        if (!canCraft(bag, r)) return node.emit('craft:denied', { recipe: r.id, reason: 'ingredients' });
        if (node.data('craftQueue')) { node.emit('craft:queue', { recipe: r, by: who }); return; }
        for (const [k, v] of r.need) bag.remove(k, v);
        bag.add(r.id, r.count);
        who.emit('inv:changed', {});
        node.emit('crafted', { item: r.id, count: r.count, by: who });
    };
    node.on('craft', craft);
    const stop = $.updateFor(node, (dt, self) => {
        const who = nearPress($, self, config);
        if (!who) return;
        const bag = bagOf(who);
        $.emit('craft:menu', { station: self, by: who, recipes: (self.data('recipes') || []).map((r) => ({ ...r, ready: !!bag && canCraft(bag, r) })) });
    });
    return () => { stop(); node.off('craft', craft); };
}
