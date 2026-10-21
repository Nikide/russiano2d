
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function dialogueAnchor(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        if (!config.dialog || $.dialog.isOpen() || !nearPress($, self, config, sel)) return;
        if (!$.dialog.has(config.dialog)) { self.emit('dialog:missing', { dialog: config.dialog }); return; }
        $.dialog.play(config.dialog);
        self.emit('dialog:start', { dialog: config.dialog });
    });
}
