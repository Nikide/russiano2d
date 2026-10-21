
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config, sel) {
    const who = sel(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function questGiver(node, config, $) {
    // Кэш принадлежит экземпляру; удалённая цель разрешается заново (respawn).
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        if (!config.quest || !nearPress($, self, config, sel)) return;
        const st = $.quest.status(config.quest);
        if (st === 'available') { $.quest.accept(config.quest); self.emit('quest:given', { quest: config.quest }); }
        else if (st === 'ready') { $.quest.turnIn(config.quest); self.emit('quest:completed', { quest: config.quest }); }
        else self.emit('quest:talk', { quest: config.quest, status: st });
    });
}
