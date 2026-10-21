
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

export default function objectiveEscort(node, config, $) {
    const on = (e) => { if (!config.npc || (e.data && e.data.npc === config.npc)) advance($, config.quest, config.objective, 1); };
    $.on('escort:done', on);
    return () => $.off('escort:done', on);
}
