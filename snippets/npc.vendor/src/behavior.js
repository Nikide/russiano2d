
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function vendor(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    node.addClass('vendor');
    return $.updateFor(node, (dt, self) => {
        const who = nearPress($, self, config, sel);
        if (!who) return;
        $.emit('shop:open', { shop: self, by: who, title: config.title, stock: self.data('stock') || {} });
    });
}
