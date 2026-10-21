
// Таблица добычи: «id=вес=мин-макс»; детерминированно при $.random.seed.
function parseTable(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number(p[1]) > 0).map(([id, w, r]) => {
        const [lo, hi] = String(r || '1').split('-').map(Number);
        return { id: id.trim(), weight: Number(w), min: lo || 1, max: hi || lo || 1 };
    });
}
function roll($, table, rolls) {
    const out = {};
    for (let i = 0; i < rolls && table.length; i++) {
        const e = $.random.weighted(table.map((t) => ({ value: t, weight: t.weight })));
        out[e.id] = (out[e.id] || 0) + $.random.int(e.min, e.max);
    }
    return out;
}

// Выпавший предмет — узел в мире; подбирает collector касанием → $.emit('pickup').
function spawnPickup($, x, y, item, count, collector) {
    const n = $('<pickup>', { class: 'loot' }).at(x, y).size(10, 10).appendTo($.world);
    n.data('item', item).data('count', count);
    $.updateFor(n, (dt, me) => {
        const who = $(collector);
        if (!who.length || !me.overlaps(who)) return;
        $.emit('pickup', { item, count, by: who });
        me.remove();
    });
    return n;
}

export default function weightedDrop(node, config, $) {
    const table = parseTable(config.table);
    const on = () => {
        const opts = table.map((t) => ({ value: t, weight: t.weight }));
        if (config.nothing > 0) opts.push({ value: null, weight: config.nothing });
        if (!opts.length) return;
        const e = $.random.weighted(opts);
        if (!e) return;
        const p = node.pos();
        spawnPickup($, p.x, p.y, e.id, $.random.int(e.min, e.max), config.collector);
    };
    node.on('death', on);
    return () => node.off('death', on);
}
