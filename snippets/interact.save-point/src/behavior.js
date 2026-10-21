
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function savePoint(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    node.addClass('interactive').data('prompt', 'Сохранить');
    return $.updateFor(node, (dt, self) => {
        if (!nearPress($, self, config, sel)) return;
        const ok = $.save.slot(config.saveSlot).save({ meta: { point: self.attr('id') } });
        self.emit(ok === false ? 'save:failed' : 'save:done', { slot: config.saveSlot });
    });
}
