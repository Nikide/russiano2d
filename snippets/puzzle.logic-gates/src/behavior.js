// Ворота считаются по порядку; вход — id узла (data on) или имя предыдущих ворот.
export default function logicGates(node, config, $) {
    const gates = config.gates.map((s) => /^\s*([\w-]+)\s*=\s*(AND|OR|NOT|XOR|NAND|NOR)\s+([\w\-, ]+)$/i.exec(s)).filter(Boolean)
        .map((m) => ({ name: m[1], op: m[2].toUpperCase(), ins: m[3].split(',').map((x) => x.trim()).filter(Boolean) }));
    let last = null;
    return $.updateFor(node, () => {
        const v = {};
        const val = (k) => k in v ? v[k] : !!$('#' + k).data('on');
        for (const g of gates) {
            const a = g.ins.map(val);
            v[g.name] = g.op === 'AND' ? a.every(Boolean) : g.op === 'OR' ? a.some(Boolean) : g.op === 'NOT' ? !a[0]
                : g.op === 'XOR' ? a.filter(Boolean).length % 2 === 1 : g.op === 'NAND' ? !a.every(Boolean) : !a.some(Boolean);
        }
        const out = !!v[config.output];
        node.data('gates', v);
        if (out === last) return;
        last = out;
        $.emit(out ? config.onEvent : config.offEvent, { puzzle: node.attr('id') });
    });
}
