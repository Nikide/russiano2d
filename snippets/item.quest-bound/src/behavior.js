
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function questBound(node, config, $) {
    let keep = 0, allowed = 0;
    const consume = (e) => { if (e.data && e.data.item === config.item) allowed += e.data.count || 1; };
    node.on('quest:consume', consume);
    const stop = $.updateFor(node, (dt, self) => {
        const bag = bagOf(self);
        if (!bag || !config.item) return;
        const n = bag.count(config.item);
        if (n >= keep) { keep = n; return; }
        const lost = keep - n, ok = Math.min(lost, allowed);
        allowed -= ok;
        const back = lost - ok;
        if (back > 0) { bag.add(config.item, back); self.emit('item:protected', { item: config.item, count: back }); }
        keep = bag.count(config.item);
    });
    return () => { stop(); node.off('quest:consume', consume); };
}
