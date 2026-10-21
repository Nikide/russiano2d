// Звуки: weapon:fire, weapon:reload-request, ammo:empty на узле.
export default function weaponAudio(node, config, $) {
    const play = (src) => () => { if (src) { const p = node.pos(); $.audio.playAt(src, p.x, p.y); } };
    const hs = [['weapon:fire', play(config.fire)], ['weapon:reload-request', play(config.reload)], ['ammo:empty', play(config.dry)]];
    for (const [ev, h] of hs) node.on(ev, h);
    return () => { for (const [ev, h] of hs) node.off(ev, h); };
}
