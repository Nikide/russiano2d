
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function questPayment(node, config, $) {
    let held = 0;
    const handlers = counts(config.stages).map(([ev, sum]) => [ev, () => {
        const who = $(config.to);
        if (!who.length) return;
        const keep = ev === config.final ? 0 : Math.round(sum * config.hold);
        held += keep;
        let pay = sum - keep;
        if (ev === config.final) { pay += held; held = 0; }
        who.emit('money', { delta: pay, reason: 'quest:' + ev });
        node.data('questHeld', held);
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
