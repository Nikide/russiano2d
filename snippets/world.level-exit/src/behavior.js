// Конец уровня: результат { level, time, secrets } в $.save 'results'.
export default function levelExit(node, config, $) {
    const start = $.time.now();
    let done = false;
    return $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        if (done || !p.length || !self.overlaps(p)) return;
        done = true;
        const res = { level: config.level, time: Math.round($.time.now() - start), secrets: Number($.save.get('secrets')) || 0 };
        const all = $.save.get('results') || {};
        all[config.level] = res;
        $.save.set('results', all);
        $.emit(config.event, res);
        if (config.next) $.scene.load(config.next);
    });
}
