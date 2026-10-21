
// «событие=файл» → [[событие, файл], …]
function cues(list) { return list.map((s) => s.split('=')).filter((p) => p.length === 2 && p[0].trim() && p[1].trim()).map(([a, b]) => [a.trim(), b.trim()]); }

export default function oneShot(node, config, $) {
    const hs = cues(config.sounds).map(([ev, src]) => [ev, () => $.audio.play(src, { bus: config.bus })]);
    for (const [ev, h] of hs) $.on(ev, h);
    return () => { for (const [ev, h] of hs) $.off(ev, h); };
}
