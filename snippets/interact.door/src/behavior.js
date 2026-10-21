
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function door(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
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
    const stop = $.updateFor(node, (dt, self) => { const who = nearPress($, self, config, sel); if (who) tryToggle(who); });
    return () => { stop(); node.off('interact', onInteract); node.off('unlock', onUnlock); };
}
