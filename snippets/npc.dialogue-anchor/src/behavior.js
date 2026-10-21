
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function dialogueAnchor(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (!config.dialog || $.dialog.isOpen() || !nearPress($, self, config)) return;
        if (!$.dialog.has(config.dialog)) { self.emit('dialog:missing', { dialog: config.dialog }); return; }
        $.dialog.play(config.dialog);
        self.emit('dialog:start', { dialog: config.dialog });
    });
}
