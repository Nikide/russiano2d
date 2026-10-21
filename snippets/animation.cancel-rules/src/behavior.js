// Прерывание: 'да' — data animLock снимается, 'нет' — событие игнорируется пока клип идёт (cancel:denied).
export default function cancelRules(node, config, $) {
    const rules = config.rules.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, ok]) => [ev.trim(), /^(да|yes|true|1)$/i.test(ok.trim())]);
    const handlers = rules.map(([ev, ok]) => [ev, () => {
        if (!node.data('animLock')) return;
        if (ok) { node.data('animLock', false).data('animKey', ''); node.emit('anim:cancelled', { by: ev }); }
        else node.emit('cancel:denied', { by: ev });
    }]);
    for (const [ev, h] of handlers) node.on(ev, h);
    return () => { for (const [ev, h] of handlers) node.off(ev, h); };
}
