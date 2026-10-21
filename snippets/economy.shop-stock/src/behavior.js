
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function shopStock(node, config, $) {
    const max = counts(config.max);
    let t = config.interval;
    return $.updateFor(node, (dt, self) => {
        t -= dt * 1000;
        if (t > 0) return;
        t = config.interval;
        const stock = self.data('stock') || {};
        for (const [id, n] of max) if ((stock[id] ?? 0) >= 0) stock[id] = n;
        self.data('stock', stock).emit('shop:restocked', {});
    });
}
