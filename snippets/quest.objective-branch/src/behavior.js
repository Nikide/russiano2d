
// Прогресс цели задания: +n к $.quest.progress(id, index); готово — событие quest:ready.
function advance($, quest, index, n) {
    if (!quest || $.quest.status(quest) !== 'active') return false;
    $.quest.progress(quest, index, ($.quest.progress(quest, index) || 0) + (n || 1));
    if ($.quest.isReady(quest)) $.emit('quest:ready', { quest });
    return true;
}

// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function objectiveBranch(node, config, $) {
    let chosen = null;
    const handlers = config.branches.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, idx]) => [ev.trim(), () => {
        if (chosen !== null) return;
        chosen = ev.trim();
        $.story.set(config.flag, chosen);
        advance($, config.quest, Number(idx), 1);
        $.emit('quest:branch', { quest: config.quest, branch: chosen });
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
