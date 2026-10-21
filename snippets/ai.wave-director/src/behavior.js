// Волны: событие wave:start/clear, итог — waves:done. Позиции — детерминированная сетка в зоне.
export default function waveDirector(node, config, $) {
    const [ax, ay, aw, ah] = config.area.split(',').map(Number);
    let wave = 0, live = [], pause = config.pause, done = false;
    return $.updateFor(node, (dt, self) => {
        if (done || !config.prefab || !$.prefab.has(config.prefab)) return;
        live = live.filter((n) => !n.removed && !(n.max_hp > 0 && n.cur_hp <= 0));
        if (live.length) return;
        if (wave > 0 && pause === config.pause) $.emit('wave:clear', { wave });
        pause -= dt * 1000;
        if (pause > 0) return;
        pause = config.pause;
        if (config.waves && wave >= config.waves) { done = true; $.emit('waves:done', { waves: wave }); return; }
        wave++;
        const count = Math.round(config.first * Math.pow(config.growth, wave - 1));
        const cols = Math.ceil(Math.sqrt(count));
        for (let i = 0; i < count; i++) {
            const x = ax + (i % cols + 0.5) * aw / cols, y = ay + (Math.floor(i / cols) + 0.5) * ah / Math.ceil(count / cols);
            const w = $.prefab.instantiate(config.prefab, { x, y, parent: $.world });
            if (w && w.nodes) live.push(...w.nodes);
        }
        $.emit('wave:start', { wave, count });
    });
}
