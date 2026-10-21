// Стройка: клетка свободна, если в ней нет узлов с телом; плата — событие money у плательщика.
export default function towerPlacement(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let on = false;
    return $.updateFor(node, () => {
        if ($.input.pressed(config.toggleKey)) { on = !on; $.emit('build:mode', { on }); }
        if (!on || !$.input.mousePressed('left') || !config.prefab || !$.prefab.has(config.prefab)) return;
        const m = $.input.mouseWorld();
        if (!m) return;
        const C = config.cell, x = Math.floor(m.x / C) * C + C / 2, y = Math.floor(m.y / C) * C + C / 2;
        if ($.world.query(x, y, C / 3).nodes.some((n) => n.body >= 0 || $(n).hasClass('tower'))) { $.emit('build:blocked', { x, y }); return; }
        const payer = sel(config.payer);
        if ((Number(payer.data('money')) || 0) < config.cost) { $.emit('build:no-money', {}); return; }
        payer.emit('money', { delta: -config.cost, reason: 'build' });
        const t = $.prefab.instantiate(config.prefab, { x, y, parent: $.world });
        if (t) t.addClass('tower');
        $.emit('build:placed', { x, y });
    });
}
