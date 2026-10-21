// Вход: $.store 'spawn' — id узла-точки; иначе fallback.
export default function sceneEntry(node, config, $) {
    let done = false;
    return $.updateFor(node, () => {
        if (done) return;
        const p = $(config.player);
        if (!p.length) return;
        done = true;
        const id = $.store.get('spawn', '');
        const at = id && $('#' + id).length ? $('#' + id).pos() : { x: config.fallback[0], y: config.fallback[1] };
        p.at(at.x, at.y).velocity(0, 0);
        $.store.remove('spawn');
        $.emit(config.introEvent, { spawn: id || null });
    });
}
