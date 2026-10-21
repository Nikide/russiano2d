
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function chest(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let opened = false;
    node.addClass('interactive').data('prompt', 'Открыть').data('locked', config.locked);
    const open = (who) => {
        if (opened) return;
        if (node.data('locked')) { node.emit('chest:locked', {}); return; }
        opened = true;
        const inv = who.data('inv');
        for (const [id, n] of counts(config.contents)) {
            if (inv && inv.add && (!$.items.has || $.items.has(id))) inv.add(id, n);
            else $.emit('pickup', { item: id, count: n, by: who });
        }
        node.data('prompt', '').emit('chest:open', { by: who });
        $.emit('inv:changed', { by: who });
    };
    const onInteract = (e) => open(e.data.by);
    node.on('interact', onInteract);
    const stop = $.updateFor(node, (dt, self) => { const who = nearPress($, self, config, sel); if (who) open(who); });
    return () => { stop(); node.off('interact', onInteract); };
}
