// Открытие: один раз; $.store.set('unlocked:<feature>', true).
export default function unlock(node, config, $) {
    let done = !!$.store.get('unlocked:' + config.feature, false);
    const open = () => { if (done) return; done = true; $.store.set('unlocked:' + config.feature, true); $.emit('unlock', { feature: config.feature }); };
    if (config.event) $.on(config.event, open);
    const stop = $.updateFor(node, () => {
        if (done) return;
        const w = $(config.who);
        if (!w.length) return;
        const lvOk = !config.level || (w.data('level') || 1) >= config.level;
        const flagOk = !config.flag || !!w.data(config.flag);
        if ((config.level || config.flag) && lvOk && flagOk) open();
    });
    return () => { stop(); if (config.event) $.off(config.event, open); };
}
