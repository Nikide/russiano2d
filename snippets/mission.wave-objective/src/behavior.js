
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

export default function waveObjective(node, config, $) {
    let cleared = 0, t = 0, over = false;
    const on = () => { if (over) return; cleared++; if (cleared >= config.waves) { over = true; advance($, config.quest, config.objective, 1); } };
    $.on('wave:clear', on);
    const stop = $.updateFor(node, (dt) => {
        if (over || !config.limit) return;
        t += dt * 1000;
        if (t >= config.limit) { over = true; $.emit('mission:failed', { quest: config.quest, reason: 'time' }); }
    });
    return () => { stop(); $.off('wave:clear', on); };
}
