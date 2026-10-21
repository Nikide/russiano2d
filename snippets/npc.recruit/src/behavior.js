
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

// Партия хранится у лидера: data('party') — массив id участников по порядку.
function partyOf(leader) { return (leader.data('party') || []).slice(); }

export default function recruit(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const id = node.attr('id');
    return $.updateFor(node, (dt, self) => {
        if (!nearPress($, self, config, sel)) return;
        const l = $(config.leader), p = partyOf(l);
        if (p.includes(id)) return;
        if (p.length >= config.limit) { self.emit('recruit:full', { limit: config.limit }); return; }
        self.emit('party:join', {});
        if (!partyOf(l).includes(id)) { p.push(id); l.data('party', p); $.emit('party:changed', { party: p }); }
        self.emit('recruited', {});
    });
}
