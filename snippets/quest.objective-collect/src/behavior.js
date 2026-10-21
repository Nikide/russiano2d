
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

export default function objectiveCollect(node, config, $) {
    const on = (e) => { const d = e.data || {}; if (d.item === config.item) advance($, config.quest, config.objective, d.count || 1); };
    $.on('pickup', on);
    return () => $.off('pickup', on);
}
