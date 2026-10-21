
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function failureCondition(node, config, $) {
    let failed = false;
    const fail = (reason) => { if (failed || $.quest.status(config.quest) !== 'active') return; failed = true; $.quest.cancel(config.quest); $.emit(config.failEvent, { quest: config.quest, reason }); };
    const onEvent = () => fail('event');
    if (config.event) $.on(config.event, onEvent);
    const stop = $.updateFor(node, () => {
        if (config.watch) { const w = $(config.watch); if (w.length && w.get(0).max_hp > 0 && !w.alive()) fail('death'); }
        if (config.flag && flags($)[config.flag]) fail('flag');
    });
    return () => { stop(); if (config.event) $.off(config.event, onEvent); };
}
