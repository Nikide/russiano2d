// Доп. цель: проверяется в момент, когда задание готово к сдаче или сдано.
export default function optionalObjective(node, config, $) {
    let paid = false;
    return $.updateFor(node, () => {
        if (paid || !config.quest) return;
        const st = $.quest.status(config.quest);
        if (st !== 'ready' && st !== 'done') return;
        const def = $.quest.def(config.quest), o = def && def.objectives[config.objective];
        if (o && ($.quest.progress(config.quest, config.objective) || 0) >= (o.count || 1)) { paid = true; $.emit(config.rewardEvent, { quest: config.quest }); }
        else if (st === 'done') paid = true;
    });
}
