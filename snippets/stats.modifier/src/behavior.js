// Итог = (база + Σ+) × Π*; пишется в data(stat). Временные — health.buff-debuff.
function parse(list) { return list.map((s) => /^([\w-]+)\s*([+*])\s*(-?[\d.]+)$/.exec(s.trim())).filter(Boolean).map((m) => ({ stat: m[1], op: m[2], v: Number(m[3]) })); }

export default function statsModifier(node, config, $) {
    const mods = parse(config.mods);
    const apply = (on) => {
        const base = node.data('baseStats') || {};
        for (const stat of new Set(mods.map((m) => m.stat))) {
            if (base[stat] === undefined) continue;
            let add = 0, mul = 1;
            if (on) for (const m of mods) if (m.stat === stat) { if (m.op === '+') add += m.v; else mul *= m.v; }
            node.data(stat, (base[stat] + add) * mul);
        }
        node.emit('stats:changed', {});
    };
    apply(true);
    return () => apply(false);
}
