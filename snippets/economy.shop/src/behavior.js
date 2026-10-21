
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Ассортимент лавки: data('stock') = { id: количество (-1 — без лимита) }.
function priceOf($, shop, id, buyer) {
    const def = $.items.get(id);
    const mul = (Number(shop.data('priceMul')) || 1) * (Number(buyer && buyer.data('priceMulFor:' + shop.attr('id'))) || 1);
    return def ? Math.max(0, Math.round((def.value || 0) * mul)) : null;
}

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

// Кошелёк узла — data('money'); изменения — событием 'money' { delta, reason }.
function money(w) { return Number(w.data('money')) || 0; }

export default function shop(node, config, $) {
    const stock = Object.fromEntries(counts(config.stock));
    node.data('stock', stock);
    const buy = (e) => {
        const d = e.data || {}, who = $(d.by), n = d.count || 1, bag = bagOf(who), price = priceOf($, node, d.item, who);
        if (price === null || !bag) return node.emit('shop:denied', { item: d.item, reason: 'unknown' });
        if (stock[d.item] === undefined || (stock[d.item] >= 0 && stock[d.item] < n)) return node.emit('shop:denied', { item: d.item, reason: 'stock' });
        if (money(who) < price * n) return node.emit('shop:denied', { item: d.item, reason: 'money' });
        if (!bag.fits(d.item, n)) return node.emit('shop:denied', { item: d.item, reason: 'space' });
        bag.add(d.item, n);
        if (stock[d.item] > 0) stock[d.item] -= n;
        who.emit('money', { delta: -price * n, reason: 'buy:' + d.item });
        node.data('stock', stock).emit('shop:sold', { item: d.item, count: n, price });
    };
    const sell = (e) => {
        const d = e.data || {}, who = $(d.by), n = d.count || 1, bag = bagOf(who), price = priceOf($, node, d.item, who);
        if (price === null || !bag || bag.count(d.item) < n) return node.emit('shop:denied', { item: d.item, reason: 'missing' });
        bag.remove(d.item, n);
        if (stock[d.item] !== undefined && stock[d.item] >= 0) stock[d.item] += n;
        who.emit('money', { delta: Math.round(price * config.sellRate) * n, reason: 'sell:' + d.item });
        node.data('stock', stock).emit('shop:bought', { item: d.item, count: n });
    };
    node.on('shop:buy', buy);
    node.on('shop:sell', sell);
    return () => { node.off('shop:buy', buy); node.off('shop:sell', sell); };
}
