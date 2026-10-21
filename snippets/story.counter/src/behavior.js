
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function storyCounter(node, config, $) {
    const th = counts(config.thresholds.map((s) => { const [v, ev] = s.split('='); return ev + '=' + v; }));
    const handlers = counts(config.changes).map(([ev, d]) => [ev, () => {
        const before = Number(flags($)[config.name]) || 0, after = before + d;
        $.story.set(config.name, after);
        for (const [tev, v] of th) if ((before < v && after >= v) || (before > v && after <= v)) $.emit(tev, { name: config.name, value: after });
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
