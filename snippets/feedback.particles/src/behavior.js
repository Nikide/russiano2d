
// «событие=файл» → [[событие, файл], …]
function cues(list) { return list.map((s) => s.split('=')).filter((p) => p.length === 2 && p[0].trim() && p[1].trim()).map(([a, b]) => [a.trim(), b.trim()]); }

export default function feedbackParticles(node, config, $) {
    const hs = cues(config.effects).map(([ev, preset]) => [ev, () => {
        const p = node.pos();
        const e = $('<particles>', $.particles.preset(preset, {})).at(p.x, p.y).appendTo($.world);
        $.time.wait(config.life).then(() => e.remove());
    }]);
    for (const [ev, h] of hs) node.on(ev, h);
    return () => { for (const [ev, h] of hs) node.off(ev, h); };
}
