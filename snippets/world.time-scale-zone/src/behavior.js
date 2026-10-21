// Темп: вход — scale, выход — прежний.
export default function timeScaleZone(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let inside = false, before = 1;
    const stop = $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        if (inside) { before = $.time.scale(); $.time.scale(config.scale); } else $.time.scale(before);
    });
    return () => { stop(); if (inside) $.time.scale(before); };
}
