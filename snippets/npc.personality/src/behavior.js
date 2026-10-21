// Черты в .data('traits'); множитель скорости от смелости — для ai.* через data('speedMul').
export default function personality(node, config, $) {
    const traits = {};
    for (const s of config.traits) { const [k, v] = s.split('='); const n = Number(v); if (k && Number.isFinite(n)) traits[k.trim()] = Math.max(0, Math.min(1, n)); }
    node.data('traits', traits).data('speedMul', 1 + ((traits.bravery ?? 0.5) - 0.5) * 2 * config.speedSpread);
    node.emit('personality', { traits });
    return () => {};
}
