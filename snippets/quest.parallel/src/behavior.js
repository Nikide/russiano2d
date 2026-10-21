// Параллельно: цели независимы; отчёт о прогрессе после каждого изменения.
export default function questParallel(node, config, $) {
    let last = -1;
    return $.updateFor(node, () => {
        if (!config.quest || $.quest.status(config.quest) !== 'active') return;
        const def = $.quest.def(config.quest);
        const done = config.objectives.map(Number).filter((i) => def && def.objectives[i] && ($.quest.progress(config.quest, i) || 0) >= (def.objectives[i].count || 1)).length;
        if (done === last) return;
        last = done;
        $.emit('parallel:progress', { quest: config.quest, done, of: config.objectives.length });
        if (done === config.objectives.length) $.emit('parallel:done', { quest: config.quest });
    });
}
