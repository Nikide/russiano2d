
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function questDefinition(node, config, $) {
    const objectives = config.objectives.map((s, i) => { const k = s.lastIndexOf('='); const text = k > 0 ? s.slice(0, k).trim() : s.trim();
        const count = k > 0 ? Number(s.slice(k + 1)) || 1 : 1; return { kind: 'object', object_id: config.id + ':' + i, count, text }; });
    $.quest.define({ id: config.id, title: config.title, giver: config.giver || undefined, after: config.after, objectives,
        reward: { money: config.money, items: Object.fromEntries(counts(config.items)) } });
    if (config.autoAccept && $.quest.status(config.id) === 'available') $.quest.accept(config.id);
    return () => {};
}
