// Сглаживание: follow со smooth; при отставании дольше maxLag — рывок к цели.
export default function cameraSmoothing(node, config, $) {
    $.camera.follow(config.target, { smooth: config.smooth });
    let lag = 0;
    const stop = $.updateFor(node, (dt) => {
        if (!config.maxLag) return;
        const t = $(config.target);
        if (!t.length) return;
        if ($.camera.isOnScreen(t, -64)) { lag = 0; return; }
        lag += dt * 1000;
        if (lag >= config.maxLag) { const p = t.pos(); $.camera.at(p.x, p.y); lag = 0; }
    });
    return () => { stop(); $.camera.unfollow(); };
}
