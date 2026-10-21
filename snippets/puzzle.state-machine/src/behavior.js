// Автомат: глобальное событие переводит, только если переход разрешён из текущего.
export default function stateMachine(node, config, $) {
    let state = config.start;
    node.data('state', state).addClass('state-' + state);
    const rules = config.transitions.map((s) => /^\s*([\w-]+)\s*>\s*([\w-]+)\s*=\s*(\S+)\s*$/.exec(s)).filter(Boolean).map((m) => ({ from: m[1], to: m[2], ev: m[3] }));
    const handlers = [...new Set(rules.map((r) => r.ev))].map((ev) => [ev, () => {
        const r = rules.find((x) => x.ev === ev && x.from === state);
        if (!r) return;
        node.removeClass('state-' + state).addClass('state-' + r.to).data('state', r.to);
        node.emit('state', { from: state, to: r.to });
        state = r.to;
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
