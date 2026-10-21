
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function lever(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let on = false;
    const view = () => node.flip(on).color(on ? config.onColor : config.offColor);
    const pull = () => { on = !on; view(); node.data('on', on).emit('lever', { on }); if (config.event) $.emit(config.event + (on ? ':on' : ':off'), { lever: node.attr('id') }); };
    node.addClass('interactive').data('prompt', 'Потянуть');
    node.on('interact', pull);
    view();
    const stop = $.updateFor(node, (dt, self) => { if (nearPress($, self, config, sel)) pull(); });
    return () => { stop(); node.off('interact', pull); };
}
