
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function switchToggle(node, config, $) {
    let on = false, used = false;
    const toggle = () => {
        if (config.once && used) return;
        used = true; on = !on;
        node.data('on', on).emit('switch', { on });
        const ev = on ? config.onEvent : config.offEvent;
        if (ev) $.emit(ev, { switch: node.attr('id') });
    };
    node.addClass('interactive').data('prompt', 'Переключить');
    node.on('interact', toggle);
    const stop = $.updateFor(node, (dt, self) => { if (nearPress($, self, config)) toggle(); });
    return () => { stop(); node.off('interact', toggle); };
}
