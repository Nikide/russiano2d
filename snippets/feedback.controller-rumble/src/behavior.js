
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function rumble(node, config, $) {
    const hs = counts(config.events).map(([ev, k]) => [ev, () => {
        if ($.store.get('rumble', true) === false || !$.input.rumbleSupported()) return;
        const s = Math.min(config.cap, Math.max(0, k));
        $.input.rumble({ weak: s * 0.5, strong: s, duration: Math.min(2000, config.ms) });
    }]);
    for (const [ev, h] of hs) { $.on(ev, h); node.on(ev, h); }
    return () => { for (const [ev, h] of hs) { $.off(ev, h); node.off(ev, h); } };
}
