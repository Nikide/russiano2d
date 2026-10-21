
// Кошелёк узла — data('money'); изменения — событием 'money' { delta, reason }.
function money(w) { return Number(w.data('money')) || 0; }

export default function wallet(node, config, $) {
    if (node.data('money') === undefined) node.data('money', config.start);
    const on = (e) => {
        const d = Number(e.data && e.data.delta) || 0, now = money(node);
        if (now + d < 0) { node.emit('money:denied', { need: -d, have: now, reason: e.data.reason }); return; }
        node.data('money', Math.min(config.max, now + d));
        node.emit('money:changed', { delta: d, money: money(node), reason: e.data.reason || '' });
    };
    node.on('money', on);
    return () => node.off('money', on);
}
