// Открытие: один раз; $.store.set('unlocked:<feature>', true).
export default function unlock(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let done = !!$.store.get('unlocked:' + config.feature, false);
    const open = () => { if (done) return; done = true; $.store.set('unlocked:' + config.feature, true); $.emit('unlock', { feature: config.feature }); };
    if (config.event) $.on(config.event, open);
    const stop = $.updateFor(node, () => {
        if (done) return;
        const w = sel(config.who);
        if (!w.length) return;
        const lvOk = !config.level || (w.data('level') || 1) >= config.level;
        const flagOk = !config.flag || !!w.data(config.flag);
        if ((config.level || config.flag) && lvOk && flagOk) open();
    });
    return () => { stop(); if (config.event) $.off(config.event, open); };
}
