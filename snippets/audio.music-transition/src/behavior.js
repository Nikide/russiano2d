
// «событие=файл» → [[событие, файл], …]
function cues(list) { return list.map((s) => s.split('=')).filter((p) => p.length === 2 && p[0].trim() && p[1].trim()).map(([a, b]) => [a.trim(), b.trim()]); }

export default function musicTransition(node, config, $) {
    const hs = cues(config.tracks).map(([ev, src]) => [ev, () => $.sound.crossfade(src, config.fade)]);
    for (const [ev, h] of hs) $.on(ev, h);
    return () => { for (const [ev, h] of hs) $.off(ev, h); };
}
