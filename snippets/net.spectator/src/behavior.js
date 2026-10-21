// Наблюдатель: только камера; никаких узлов и владения.
export default function spectator(node, config, $) {
    let i = 0;
    const show = () => { const list = $(config.players).nodes; if (!list.length) return; i = (i + list.length) % list.length; $.camera.follow($(list[i])); $.emit('spectate', { id: $(list[i]).attr('id') }); };
    const stop = $.updateFor(node, () => {
        if ($.input.pressed(config.next)) { i++; show(); }
        if ($.input.pressed(config.prev)) { i--; show(); }
    });
    show();
    return () => stop();
}
