
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function dialogueCondition(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, () => {
        const w = sel(config.who);
        let v = 0;
        if (config.source === 'item') { const b = bagOf(w); v = b ? b.count(config.key) : 0; }
        else if (config.source === 'data') v = Number(w.length ? w.data(config.key) : 0) || 0;
        else if (config.source === 'relationship') v = Number($(config.key).data('relationship')) || 0;
        else v = Number(flags($)[config.key]) || (flags($)[config.key] ? 1 : 0);
        $.dialog.flag(config.flag, v >= config.atLeast);
    });
}
