// Испытание: окно с начала первого события; успех → $.emit(rewardEvent).
export default function challenge(node, config, $) {
    let n = 0, start = 0, done = false;
    const on = () => {
        if (done) return;
        const now = $.time.now();
        if (!n || (config.window && now - start > config.window)) { n = 0; start = now; }
        n++;
        $.emit('challenge:progress', { count: n, of: config.count });
        if (n < config.count) return;
        $.emit('challenge:done', { event: config.event });
        if (config.rewardEvent) $.emit(config.rewardEvent, {});
        n = 0;
        if (!config.repeat) done = true;
    };
    $.on(config.event, on);
    return () => $.off(config.event, on);
}
