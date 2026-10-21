// Без выполнения выражений: только вид «цель=источник*k+b».
function parse(list) {
    return list.map((s) => /^([\w-]+)\s*=\s*([\w-]+)\s*\*\s*(-?[\d.]+)\s*(?:([+-])\s*([\d.]+))?$/.exec(s.replace(/\s+/g, ' ').trim()))
        .filter(Boolean).map((m) => ({ to: m[1], from: m[2], k: Number(m[3]), b: m[4] ? (m[4] === '-' ? -1 : 1) * Number(m[5]) : 0 }));
}

export default function statsDerived(node, config, $) {
    const f = parse(config.formulas);
    const compute = () => {
        for (const r of f) {
            const v = (Number(node.data(r.from)) || 0) * r.k + r.b;
            node.data(r.to, v);
            if (r.to === 'maxHp') node.maxHp(v);
            if (r.to === 'speed') node.speed(v);
        }
    };
    node.on('stats:changed', compute);
    node.on('stats', compute);
    compute();
    return () => { node.off('stats:changed', compute); node.off('stats', compute); };
}
