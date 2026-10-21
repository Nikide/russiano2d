
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function startCondition(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const go = () => { if (config.quest && $.quest.status(config.quest) === 'available') { $.quest.accept(config.quest); $.emit('quest:started', { quest: config.quest }); } };
    if (config.event) $.on(config.event, go);
    const stop = $.updateFor(node, () => {
        if (!config.flag && !config.level) return;
        const p = sel(config.player);
        const flagOk = !config.flag || !!flags($)[config.flag];
        const lvOk = !config.level || (p.length && (p.data('level') || 1) >= config.level);
        if (flagOk && lvOk) go();
    });
    return () => { stop(); if (config.event) $.off(config.event, go); };
}
