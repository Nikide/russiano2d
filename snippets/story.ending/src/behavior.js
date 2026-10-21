
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function storyEnding(node, config, $) {
    const list = config.endings.map((s) => { const [name, req] = s.split(':'); return { name: name.trim(), req: (req || '').split(',').map((x) => x.trim()).filter(Boolean) }; }).filter((e) => e.name);
    const check = () => {
        const f = flags($);
        const hit = list.find((e) => e.req.every((r) => r.startsWith('!') ? !f[r.slice(1)] : !!f[r]));
        if (!hit) return;
        $.story.set('ending', hit.name);
        $.emit('ending', { name: hit.name });
    };
    $.on(config.checkEvent, check);
    return () => $.off(config.checkEvent, check);
}
