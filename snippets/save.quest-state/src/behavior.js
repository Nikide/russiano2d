// Задания: снимок $.quest при сохранении, восстановление при загрузке.
export default function saveQuestState(node, config, $) {
    const write = () => $.save.set(config.key, $.quest.save());
    const read = () => { const d = $.save.get(config.key); if (d) $.quest.load(d); };
    $.on('save:before', write); $.on('saved', write); $.on('loaded', read);
    return () => { $.off('save:before', write); $.off('saved', write); $.off('loaded', read); };
}
