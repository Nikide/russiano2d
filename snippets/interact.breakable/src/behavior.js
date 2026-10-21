
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function breakableHits(node, config, $) {
    let left = config.hits;
    if (!(node.hp() > 0)) node.health(1000000);    // здоровье — только чтобы приходили удары
    const on = () => {
        left--;
        node.flash('#ffffff', 60).data('hitsLeft', left);
        if (left > 0) return;
        const p = node.pos();
        for (const [id, n] of counts(config.drop)) $.emit('drop', { item: id, count: n, x: p.x, y: p.y, for: config.collector });
        node.emit('broken', {});
        node.remove();
    };
    node.on('damaged', on);
    return () => node.off('damaged', on);
}
