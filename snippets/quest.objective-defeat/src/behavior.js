
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

export default function objectiveDefeat(node, config, $) {
    const dead = new Set();
    return $.updateFor(node, () => {
        $(config.targets).each((i, t) => {
            const raw = t.get(0);
            if (dead.has(raw) || !(raw.max_hp > 0) || raw.cur_hp > 0) return;
            dead.add(raw);
            advance($, config.quest, config.objective, 1);
        });
    });
}
