
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

export default function objectiveSurvive(node, config, $) {
    let t = 0, done = false;
    return $.updateFor(node, (dt) => {
        if (done || $.quest.status(config.quest) !== 'active') { t = 0; return; }
        const p = $(config.player);
        if (!p.length || !p.alive()) { t = 0; return; }
        t += dt * 1000;
        $.emit('survive:progress', { left: Math.max(0, config.time - t) });
        if (t >= config.time) done = advance($, config.quest, config.objective, 1);
    });
}
