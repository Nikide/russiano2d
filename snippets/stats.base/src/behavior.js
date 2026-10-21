
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function statsBase(node, config, $) {
    const base = Object.fromEntries(counts(config.stats));
    node.data('baseStats', base);
    for (const [k, v] of Object.entries(base)) node.data(k, v);
    node.emit('stats', { stats: base });
    return () => {};
}
