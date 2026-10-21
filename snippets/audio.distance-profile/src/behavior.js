// Затухание: линейно между near и far; громкость хэндла каждый кадр.
export default function distanceProfile(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const h = $.audio.play(config.sound, { loop: true, volume: 0 });
    const stop = $.updateFor(node, (dt, self) => {
        const l = sel(config.listener);
        if (!l.length || !h || !h.volume) return;
        const d = self.distanceTo(l);
        h.volume(Math.max(0, Math.min(1, 1 - (d - config.near) / Math.max(1, config.far - config.near))));
    });
    return () => { stop(); if (h && h.stop) h.stop(); };
}
