// Замок: data('locked'); глобальное событие или выполненное условие → unlock на узле.
export default function lock(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    node.data('locked', config.locked);
    const open = () => { if (!node.data('locked')) return; node.data('locked', false); node.emit('unlock', {}); $.emit('lock:opened', { lock: node.attr('id') }); };
    if (config.unlockEvent) $.on(config.unlockEvent, open);
    const stop = config.requires ? $.updateFor(node, () => { const p = sel(config.player); if (p.length && p.data(config.requires)) open(); }) : () => {};
    return () => { stop(); if (config.unlockEvent) $.off(config.unlockEvent, open); };
}
