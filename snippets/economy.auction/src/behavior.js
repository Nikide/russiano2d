
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

// Кошелёк узла — data('money'); изменения — событием 'money' { delta, reason }.
function money(w) { return Number(w.data('money')) || 0; }

export default function auction(node, config, $) {
    let best = null, left = config.duration, closed = false;
    const bid = (e) => {
        const d = e.data || {}, who = $(d.by), need = best ? best.amount + config.step : config.start;
        if (closed || !who.length || d.amount < need || money(who) < d.amount) return node.emit('auction:rejected', { need });
        best = { by: who, amount: d.amount };
        node.data('auction', { item: config.item, price: d.amount, leader: who.attr('id') }).emit('auction:leader', { amount: d.amount });
    };
    node.on('auction:bid', bid);
    const stop = $.updateFor(node, (dt, self) => {
        if (closed) return;
        left -= dt * 1000;
        if (left > 0) return;
        closed = true;
        if (!best) { self.emit('auction:no-bids', {}); return; }
        best.by.emit('money', { delta: -best.amount, reason: 'auction:' + config.item });
        const bag = bagOf(best.by);
        if (bag && $.items.has(config.item)) bag.add(config.item, 1); else $.emit('pickup', { item: config.item, count: 1, by: best.by });
        self.emit('auction:won', { by: best.by, amount: best.amount });
    });
    return () => { stop(); node.off('auction:bid', bid); };
}
