// Удержание: прогресс 0..1 в data('progress'); события hold:start/cancel и итоговое $.emit.
export default function holdAction(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let t = 0;
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.actor);
        const ok = who.length && self.distanceTo(who) <= config.radius && $.input.down(config.key);
        if (!ok) { if (t > 0) { t = 0; self.data('progress', 0).emit('hold:cancel', {}); } return; }
        if (t === 0) self.emit('hold:start', {});
        t += dt * 1000;
        self.data('progress', Math.min(1, t / config.time));
        if (t >= config.time) { t = 0; self.data('progress', 0); $.emit(config.event, { target: self, by: who }); }
    });
}
