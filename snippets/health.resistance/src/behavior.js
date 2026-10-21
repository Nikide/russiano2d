
// «тип=число» → { тип: число }
function table(list) {
    const out = {};
    for (const s of list) { const i = s.indexOf('='); if (i > 0 && Number.isFinite(Number(s.slice(i + 1)))) out[s.slice(0, i).trim()] = Number(s.slice(i + 1)); }
    return out;
}

export default function resistance(node, config, $) {
    const r = table(config.percent);
    return node.damageFilter((info) => info.amount * (1 - Math.max(-100, Math.min(100, r[info.type] || 0)) / 100));
}
