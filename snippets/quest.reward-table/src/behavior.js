
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function rewardTable(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const paid = new Set();
    return $.updateFor(node, () => {
        if (!config.quest) return;
        const def = $.quest.def(config.quest);
        if (!def) return;
        for (const [i, money] of counts(config.rewards)) {
            const o = def.objectives[i];
            if (!o || paid.has(i) || ($.quest.progress(config.quest, i) || 0) < (o.count || 1)) continue;
            paid.add(i);
            sel(config.player).emit('money', { delta: money, reason: 'quest:' + config.quest + ':' + i });
        }
    });
}
