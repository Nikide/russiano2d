// Сюжет: копия $.story.flags; при загрузке — $.story.set по каждому флагу.
export default function saveStoryState(node, config, $) {
    const flags = () => { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; };
    const write = () => $.save.set(config.key, JSON.parse(JSON.stringify(flags())));
    const read = () => { const d = $.save.get(config.key) || {}; for (const k of Object.keys(d)) $.story.set(k, d[k]); };
    $.on('save:before', write); $.on('saved', write); $.on('loaded', read);
    return () => { $.off('save:before', write); $.off('saved', write); $.off('loaded', read); };
}
