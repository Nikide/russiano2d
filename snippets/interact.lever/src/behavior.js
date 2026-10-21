
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function lever(node, config, $) {
    let on = false;
    const view = () => node.flip(on).color(on ? config.onColor : config.offColor);
    const pull = () => { on = !on; view(); node.data('on', on).emit('lever', { on }); if (config.event) $.emit(config.event + (on ? ':on' : ':off'), { lever: node.attr('id') }); };
    node.addClass('interactive').data('prompt', 'Потянуть');
    node.on('interact', pull);
    view();
    const stop = $.updateFor(node, (dt, self) => { if (nearPress($, self, config)) pull(); });
    return () => { stop(); node.off('interact', pull); };
}
