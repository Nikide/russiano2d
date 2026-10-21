
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function container(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const bag = $.inv.create({ cols: config.cols, rows: config.rows });
    for (const [id, n] of counts(config.contents)) if ($.items.has(id)) bag.add(id, n);
    node.data('inv', bag).addClass('interactive').data('prompt', 'Открыть');
    const open = (who) => $.emit('container:open', { container: node, by: who, mine: bagOf(who) ? bagOf(who).summary() : {}, theirs: bag.summary() });
    const onInteract = (e) => open(e.data.by);
    node.on('interact', onInteract);
    const stop = $.updateFor(node, (dt, self) => { const who = nearPress($, self, config, sel); if (who) open(who); });
    return () => { stop(); node.off('interact', onInteract); };
}
