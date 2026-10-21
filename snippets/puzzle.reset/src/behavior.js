// Снимок при подключении: позиция, угол, классы open/found/matched, data on/state.
export default function puzzleReset(node, config, $) {
    const snap = $(config.objects).nodes.map((n) => { const w = $(n); return { n, x: n.x, y: n.y, angle: w.angle(), on: w.data('on'), state: w.data('state') }; });
    const reset = () => {
        for (const s of snap) { const w = $(s.n); if (s.n.removed) continue; w.at(s.x, s.y).angle(s.angle).velocity(0, 0).data('on', s.on).data('state', s.state); for (const c of ['open', 'found', 'matched']) w.removeClass(c); }
        $.emit('puzzle:was-reset', { puzzle: node.attr('id') });
    };
    $.on(config.event, reset);
    const stop = $.updateFor(node, () => { if (config.key && $.input.pressed(config.key)) reset(); });
    return () => { stop(); $.off(config.event, reset); };
}
