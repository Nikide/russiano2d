
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function inventoryGrid(node, config, $) {
    const bag = $.inv.create({ cols: config.cols, rows: config.rows, capacity: config.capacity });
    node.data('inv', bag);
    for (const [id, n] of counts(config.start)) if ($.items.has(id)) bag.add(id, n);
    const take = (e) => {
        const d = e.data || {};
        if (d.by && $(d.by).get(0) !== node.get(0)) return;
        if (!$.items.has(d.item)) return;
        const put = bag.add(d.item, d.count || 1);
        node.emit('inv:changed', { item: d.item, added: put });
        if (put < (d.count || 1)) node.emit('inv:full', { item: d.item, left: (d.count || 1) - put });
    };
    $.on('pickup', take);
    return () => $.off('pickup', take);
}
