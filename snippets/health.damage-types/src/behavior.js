
// «тип=число» → { тип: число }
function table(list) {
    const out = {};
    for (const s of list) { const i = s.indexOf('='); if (i > 0 && Number.isFinite(Number(s.slice(i + 1)))) out[s.slice(0, i).trim()] = Number(s.slice(i + 1)); }
    return out;
}

export default function damageTypes(node, config, $) {
    const t = table(config.multipliers);
    node.data('damageTypes', t);
    return node.damageFilter((info) => info.amount * (t[info.type] === undefined ? 1 : t[info.type]));
}
