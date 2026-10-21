// Провода: data('wires') = { вход: выход }; повторное соединение заменяет.
export default function wiring(node, config, $) {
    const want = Object.fromEntries(config.solution.map((s) => s.split('=')).filter((p) => p.length === 2).map(([a, b]) => [a.trim(), b.trim()]));
    const wires = {};
    const on = (e) => {
        const d = e.data || {};
        if (!d.from) return;
        for (const k of Object.keys(wires)) if (wires[k] === d.to) delete wires[k];
        if (d.to) wires[d.from] = String(d.to); else delete wires[d.from];
        node.data('wires', { ...wires });
        const ok = Object.keys(want).length && Object.entries(want).every(([a, b]) => wires[a] === b);
        if (ok) $.emit(config.solvedEvent, { puzzle: node.attr('id') });
    };
    node.on('wire', on);
    return () => node.off('wire', on);
}
