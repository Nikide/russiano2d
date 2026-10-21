
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function questGiver(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (!config.quest || !nearPress($, self, config)) return;
        const st = $.quest.status(config.quest);
        if (st === 'available') { $.quest.accept(config.quest); self.emit('quest:given', { quest: config.quest }); }
        else if (st === 'ready') { $.quest.turnIn(config.quest); self.emit('quest:completed', { quest: config.quest }); }
        else self.emit('quest:talk', { quest: config.quest, status: st });
    });
}
