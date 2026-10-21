
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function objectiveDeliver(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const who = nearPress($, self, config);
        if (!who) return;
        const bag = bagOf(who);
        if (!bag || bag.count(config.item) < config.count) { self.emit('deliver:missing', { item: config.item }); return; }
        if (!advance($, config.quest, config.objective, config.count)) return;
        who.emit('quest:consume', { item: config.item, count: config.count });
        bag.remove(config.item, config.count);
        self.emit('delivered', { item: config.item, count: config.count });
    });
}
