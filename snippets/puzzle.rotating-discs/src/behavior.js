// Диски: клик по диску → .angle(+step); проверка совпадения с data('target').
export default function rotatingDiscs(node, config, $) {
    let solved = false;
    return $.updateFor(node, () => {
        if ($.input.mousePressed('left')) {
            const m = $.input.mouseWorld();
            const d = m && $(config.discs).nodes.map((n) => $(n)).find((w) => w.distanceTo(m) <= Math.max(w.width(), w.height()) / 2);
            if (d) { d.angle((d.angle() + config.step) % 360); node.emit('disc:turn', {}); }
        }
        const all = $(config.discs).nodes;
        const ok = all.length > 0 && all.every((n) => { const w = $(n); return ((Math.round(w.angle()) % 360) + 360) % 360 === ((Number(w.data('target')) || 0) % 360 + 360) % 360; });
        if (ok && !solved) { solved = true; $.emit(config.solvedEvent, { puzzle: node.attr('id') }); }
        if (!ok) solved = false;
    });
}
