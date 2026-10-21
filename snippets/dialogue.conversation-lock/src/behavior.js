// Блок: dialog start → .controls(false) и скорость 0; end → вернуть прежнюю схему.
export default function conversationLock(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let locked = false;
    const stop = $.updateFor(node, () => {
        const p = sel(config.player);
        if (!p.length) return;
        const open = $.dialog.isOpen();
        if (open && !locked) { locked = true; p.data('controlsBeforeDialog', true).velocity(0, 0).active(false); p.emit('conversation:lock', {}); }
        else if (!open && locked) { locked = false; p.active(true); p.emit('conversation:unlock', {}); }
    });
    return () => { stop(); if (locked) sel(config.player).active(true); };
}
