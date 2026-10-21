
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function chapter(node, config, $) {
    let started = false;
    const end = () => { if (!started) return; $.story.set('chapter_' + config.number + '_done', true); $.emit('chapter:done', { number: config.number }); };
    $.on(config.endEvent, end);
    const stop = $.updateFor(node, () => {
        if (started) return;
        if (config.requires.some((f) => !flags($)[f])) return;
        started = true;
        $.story.set('chapter', config.number);
        $.save.set('chapter', config.number);
        $.emit('chapter:start', { number: config.number, title: config.title });
    });
    return () => { stop(); $.off(config.endEvent, end); };
}
