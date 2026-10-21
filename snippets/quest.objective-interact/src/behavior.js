
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

export default function objectiveInteract(node, config, $) {
    const hit = () => advance($, config.quest, config.objective, 1);
    node.addClass('interactive');
    node.on('interact', hit);
    const stop = $.updateFor(node, (dt, self) => { if (nearPress($, self, config)) hit(); });
    return () => { stop(); node.off('interact', hit); };
}
