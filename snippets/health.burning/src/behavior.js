
// Периодический статус: стеки, каждый тик — урон; источник — урон нужного типа
// или событие узла 'status' { kind, stacks?, ms? }.
function periodic(node, $, kind, types, cfg, tickType, extra) {
    let stacks = 0, left = 0, tick = 0;
    const add = (n, ms) => { stacks = Math.min(cfg.maxStacks, stacks + (n || 1)); left = ms || cfg.duration; node.data(kind, stacks); node.emit(kind + ':on', { stacks }); };
    const onDamaged = (e) => { if (types.includes(e.data.type) && e.data.amount > 0) add(1); };
    const onStatus = (e) => { if (e.data && e.data.kind === kind) add(e.data.stacks, e.data.ms); if (e.data && e.data.kind === kind + ':clear') left = 0; };
    node.on('damaged', onDamaged);
    node.on('status', onStatus);
    const stop = $.updateFor(node, (dt, self) => {
        if (stacks <= 0) return;
        if (extra && extra(self)) left = 0;
        left -= dt * 1000;
        tick += dt * 1000;
        if (tick >= cfg.interval) { tick -= cfg.interval; if (self.alive()) self.damage(cfg.tickDamage * stacks, null, tickType); }
        if (left <= 0) { stacks = 0; tick = 0; self.data(kind, 0); self.emit(kind + ':off', {}); }
    });
    return () => { stop(); node.off('damaged', onDamaged); node.off('status', onStatus); };
}

export default function burning(node, config, $) {
    return periodic(node, $, 'burning', ['fire', 'explosion'], config, 'burn-tick',
        (self) => !!config.water && $(config.water).some((i, w) => self.overlaps(w)));
}
