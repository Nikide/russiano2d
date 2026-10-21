// Рыбалка: cast → bite → hook/miss; улов — $.random.weighted, событие pickup.
export default function fishing(node, config, $) {
    let state = 'idle', t = 0;
    const table = config.catch.map((s) => s.split('=')).filter((p) => p.length === 2 && Number(p[1]) > 0).map(([v, w]) => ({ value: v.trim(), weight: Number(w) }));
    const set = (s) => { state = s; node.data('fishing', s).emit('fishing:' + s, {}); };
    return $.updateFor(node, (dt, self) => {
        const press = $.input.pressed(config.key);
        if (state === 'idle') { if (press) { t = $.random.range(config.waitMin, Math.max(config.waitMin, config.waitMax)); set('cast'); } return; }
        t -= dt * 1000;
        if (state === 'cast') { if (press) set('idle'); else if (t <= 0) { t = config.window; set('bite'); } return; }
        if (state === 'bite') {
            if (press) { const fish = table.length ? $.random.weighted(table) : null; if (fish) $.emit('pickup', { item: fish, count: 1, by: self }); set('hooked'); set('idle'); }
            else if (t <= 0) set('idle');
        }
    });
}
