// Профиль: цвет мира плавно к новому значению.
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

export default function tintProfile(node, config, $) {
    let from = null, to = null, t = 0;
    const handlers = config.profiles.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, col]) => [ev.trim(), () => { from = hex($.world.getBackground ? ($.world.getBackground() || '#000000') : '#000000'); to = hex(col.trim()); t = 0; }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    const stop = $.updateFor(node, (dt) => {
        if (!to) return;
        t = Math.min(1, t + (config.ms ? dt * 1000 / config.ms : 1));
        const c = from.map((v, i) => Math.round(v + (to[i] - v) * t));
        $.world.color('#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
        if (t >= 1) to = null;
    });
    return () => { stop(); for (const [ev, h] of handlers) $.off(ev, h); };
}
