// Кооператив: второй узел #player2 с .controls(scheme) и классом player.
export default function coopLocal(node, config, $) {
    let p2 = null;
    const stop = $.updateFor(node, () => {
        if (p2 || !$.input.pressed(config.joinKey)) return;
        p2 = $('<player>', { id: 'player2', class: 'player player-2' }).at(config.spawn[0], config.spawn[1]).size(24, 24).body('dynamic').health(100).appendTo($.world);
        p2.controls(config.scheme);
        $.emit('coop:joined', { id: 'player2' });
    });
    return () => { stop(); if (p2) p2.remove(); };
}
