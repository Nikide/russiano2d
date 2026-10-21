
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function door(node, config, $) {
    let open = false;
    const set = (v) => { open = v; node.data('open', v).alpha(v ? 0.25 : 1).sensor(v); node.emit(v ? 'door:open' : 'door:close', {}); };
    const hasKey = (who) => {
        if (!config.keyItem) return true;
        const inv = who.data('inv');
        return !!who.data(config.keyItem) || !!(inv && inv.has && inv.has(config.keyItem));
    };
    const tryToggle = (who) => {
        if (node.data('locked')) { node.emit('door:locked', {}); return; }
        if (!open && !hasKey(who)) { node.emit('door:need-key', { key: config.keyItem }); return; }
        set(!open);
    };
    const onInteract = (e) => tryToggle(e.data.by);
    const onUnlock = () => node.data('locked', false);
    node.addClass('interactive').data('prompt', 'Открыть');
    node.on('interact', onInteract);
    node.on('unlock', onUnlock);
    if (config.startOpen) set(true);
    const stop = $.updateFor(node, (dt, self) => { const who = nearPress($, self, config); if (who) tryToggle(who); });
    return () => { stop(); node.off('interact', onInteract); node.off('unlock', onUnlock); };
}
