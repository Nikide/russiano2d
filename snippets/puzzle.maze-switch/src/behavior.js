// Дверь открыта, если нечётное число связанных переключателей включено (data on).
export default function mazeSwitch(node, config, $) {
    const links = config.wiring.map((s) => s.split('=')).filter((p) => p.length === 2).map(([s, ds]) => [s.trim(), ds.split(',').map((x) => x.trim()).filter(Boolean)]);
    const doors = [...new Set(links.flatMap(([, ds]) => ds))];
    let last = '';
    return $.updateFor(node, () => {
        const state = {};
        for (const d of doors) state[d] = links.filter(([s, ds]) => ds.includes(d) && $('#' + s).data('on')).length % 2 === 1;
        const key = JSON.stringify(state);
        if (key === last) return;
        last = key;
        for (const d of doors) { const w = $('#' + d); if (w.length) w.data('open', state[d]).alpha(state[d] ? 0.25 : 1).sensor(state[d]); }
        node.emit('maze', { doors: state });
    });
}
