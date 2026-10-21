// Ожидание: flip по таймеру; цель в радиусе → data awake и событие wake.
export default function idle(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let t = 0, awake = false;
    return $.updateFor(node, (dt, self) => {
        if (awake) return;
        t += dt * 1000;
        if (config.look > 0 && t >= config.look) { t = 0; self.flip(!self.flip().x); }
        const tg = sel(config.target);
        if (tg.length && self.distanceTo(tg) <= config.wake) { awake = true; self.data('awake', true); self.emit('wake', { target: tg }); }
    });
}
