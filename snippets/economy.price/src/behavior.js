
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function price(node, config, $) {
    const own = Object.fromEntries(counts(config.prices));
    for (const id of $.items.ids()) {
        const def = $.items.get(id);
        const base = own[id] !== undefined ? own[id] : def.value || 0;
        $.items.define({ ...def, value: Math.round(base * config.multiplier) });
    }
    return () => {};
}
