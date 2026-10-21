
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function relationshipRoute(node, config, $) {
    const check = () => {
        let best = null;
        for (const [flag, th] of counts(config.characters)) { const v = Number(flags($)[flag]) || 0; if (v >= th && (!best || v > best.v)) best = { flag, v }; }
        $.story.set(config.routeFlag, best ? best.flag.replace(/_points$/, '') : 'common');
        $.emit('route', { route: flags($)[config.routeFlag] });
    };
    $.on(config.checkEvent, check);
    return () => $.off(config.checkEvent, check);
}
