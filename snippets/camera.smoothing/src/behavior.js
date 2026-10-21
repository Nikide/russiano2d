// Сглаживание: follow со smooth; при отставании дольше maxLag — рывок к цели.
export default function cameraSmoothing(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    $.camera.follow(config.target, { smooth: config.smooth });
    let lag = 0;
    const stop = $.updateFor(node, (dt) => {
        if (!config.maxLag) return;
        const t = sel(config.target);
        if (!t.length) return;
        if ($.camera.isOnScreen(t, -64)) { lag = 0; return; }
        lag += dt * 1000;
        if (lag >= config.maxLag) { const p = t.pos(); $.camera.at(p.x, p.y); lag = 0; }
    });
    return () => { stop(); $.camera.unfollow(); };
}
