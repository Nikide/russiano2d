
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function reward(node, config, $) {
    let given = false;
    const on = () => {
        if (config.once && given) return;
        given = true;
        const who = $(config.to);
        if (!who.length) return;
        if (config.money) who.emit('money', { delta: config.money, reason: 'reward:' + config.event });
        const bag = bagOf(who);
        for (const [id, n] of counts(config.items)) { if (bag && $.items.has(id)) bag.add(id, n); else $.emit('pickup', { item: id, count: n, by: who }); }
        if (config.xp) who.emit('xp', { amount: config.xp, reason: config.event });
        who.emit('reward', { event: config.event });
    };
    $.on(config.event, on);
    return () => $.off(config.event, on);
}
