// Выход: таймер внутри зоны; уход сбрасывает.
export default function extraction(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let t = 0, done = false;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        const p = sel(config.player);
        const ready = !config.requireQuest || ['ready', 'done'].includes($.quest.status(config.requireQuest));
        if (!p.length || !ready || !self.overlaps(p)) { if (t) { t = 0; self.emit('extract:cancel', {}); } return; }
        t += dt * 1000;
        self.data('extractProgress', config.hold ? Math.min(1, t / config.hold) : 1);
        if (t >= config.hold) { done = true; $.emit(config.event, { at: self.attr('id') }); }
    });
}
