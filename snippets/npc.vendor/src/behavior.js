
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function vendor(node, config, $) {
    node.addClass('vendor');
    return $.updateFor(node, (dt, self) => {
        const who = nearPress($, self, config);
        if (!who) return;
        $.emit('shop:open', { shop: self, by: who, title: config.title, stock: self.data('stock') || {} });
    });
}
