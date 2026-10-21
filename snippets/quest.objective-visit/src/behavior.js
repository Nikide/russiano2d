
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

export default function objectiveVisit(node, config, $) {
    let inside = false, done = false;
    return $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        const now = p.length && self.overlaps(p);
        if (now && !inside && !(config.once && done)) { if (advance($, config.quest, config.objective, 1)) done = true; }
        inside = !!now;
    });
}
