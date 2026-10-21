
// «тип=число» → { тип: число }
function table(list) {
    const out = {};
    for (const s of list) { const i = s.indexOf('='); if (i > 0 && Number.isFinite(Number(s.slice(i + 1)))) out[s.slice(0, i).trim()] = Number(s.slice(i + 1)); }
    return out;
}

// Итог характеристики = (база + Σadd) × Πmul; пишется в .data(stat).
export default function buffDebuff(node, config, $) {
    const base = table(config.base);
    const mods = [];
    const apply = () => {
        for (const stat of Object.keys(base)) {
            let add = 0, mul = 1;
            for (const m of mods) if (m.stat === stat) { add += m.add || 0; mul *= m.mul === undefined ? 1 : m.mul; }
            node.data(stat, (base[stat] + add) * mul);
        }
    };
    const on = (e) => { const m = e.data || {}; if (!(m.stat in base)) return; mods.push({ stat: m.stat, add: m.add, mul: m.mul, left: m.ms || 0 }); apply(); };
    node.on('modifier', on);
    apply();
    const stop = $.updateFor(node, (dt) => {
        let changed = false;
        for (let i = mods.length - 1; i >= 0; i--) {
            if (mods[i].left <= 0) continue;          // без ms — постоянный
            mods[i].left -= dt * 1000;
            if (mods[i].left <= 0) { mods.splice(i, 1); changed = true; }
        }
        if (changed) apply();
    });
    return () => { stop(); node.off('modifier', on); };
}
