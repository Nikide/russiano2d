// Темп: вход — scale, выход — прежний.
export default function timeScaleZone(node, config, $) {
    let inside = false, before = 1;
    const stop = $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        if (inside) { before = $.time.scale(); $.time.scale(config.scale); } else $.time.scale(before);
    });
    return () => { stop(); if (inside) $.time.scale(before); };
}
