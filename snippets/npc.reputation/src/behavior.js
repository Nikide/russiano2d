
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function reputation(node, config, $) {
    const rep = Object.fromEntries(counts(config.factions));
    node.data('reputation', { ...rep });
    const on = (e) => {
        const d = e.data || {};
        if (!d.faction) return;
        rep[d.faction] = Math.max(config.min, Math.min(config.max, (rep[d.faction] || 0) + (Number(d.delta) || 0)));
        node.data('reputation', { ...rep });
        node.emit('reputation:changed', { faction: d.faction, value: rep[d.faction] });
    };
    $.on('reputation', on);
    return () => $.off('reputation', on);
}
