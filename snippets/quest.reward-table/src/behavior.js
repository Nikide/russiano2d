
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function rewardTable(node, config, $) {
    const paid = new Set();
    return $.updateFor(node, () => {
        if (!config.quest) return;
        const def = $.quest.def(config.quest);
        if (!def) return;
        for (const [i, money] of counts(config.rewards)) {
            const o = def.objectives[i];
            if (!o || paid.has(i) || ($.quest.progress(config.quest, i) || 0) < (o.count || 1)) continue;
            paid.add(i);
            $(config.player).emit('money', { delta: money, reason: 'quest:' + config.quest + ':' + i });
        }
    });
}
