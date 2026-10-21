
function parsePoints(text) {
    return String(text || '').split(';').map((p) => p.split(',').map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => ({ x, y }));
}

export default function cutsceneRail(node, config, $) {
    const pts = parsePoints(config.points);
    let i = -1, t = 0;
    const start = () => { if (pts.length) { i = 0; t = 0; $.camera.unfollow(); $.emit('rail:begin', {}); } };
    $.on(config.event, start);
    const stop = $.updateFor(node, (dt) => {
        if (i < 0) return;
        t += dt * 1000;
        const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], k = Math.min(1, t / config.segment);
        $.camera.at(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        if (k < 1) return;
        t = 0; i++;
        if (i >= pts.length - 1) { i = -1; $.camera.follow(config.player); $.emit('rail:end', {}); }
    });
    return () => { stop(); $.off(config.event, start); };
}
