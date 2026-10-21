
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function itemStack(node, config, $) {
    for (const [id, n] of counts(config.stacks)) {
        const def = $.items.get(id);
        if (def) $.items.define({ ...def, stack: Math.max(1, Math.floor(n)) });
    }
    return () => {};
}
