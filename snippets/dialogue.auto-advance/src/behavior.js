// Автопереход: после typed ждём delay и next(), если нет вариантов.
export default function autoAdvance(node, config, $) {
    let on = config.enabled, wait = -1;
    const typed = () => { wait = config.delay; };
    $.dialog.on('typed', typed);
    const stop = $.updateFor(node, (dt) => {
        if ($.input.pressed(config.toggleKey)) { on = !on; $.emit('dialog:auto', { on }); }
        if (!on || wait < 0 || !$.dialog.isOpen()) return;
        wait -= dt * 1000;
        if (wait <= 0) { wait = -1; if (!$.dialog.choices().length) $.dialog.next(); }
    });
    return () => { stop(); $.dialog.off('typed', typed); };
}
