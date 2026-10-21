// Конец уровня: результат { level, time, secrets } в $.save 'results'.
export default function levelExit(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const start = $.time.now();
    let done = false;
    return $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
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
