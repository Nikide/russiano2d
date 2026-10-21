// Журнал: строки $.quest.line по статусам; UI подписывается на событие journal.
export default function questJournal(node, config, $) {
    let t = 0;
    const build = () => {
        const out = { active: [], ready: [], done: [] };
        for (const def of $.quest.definitions()) {
            const st = $.quest.status(def.id);
            if (out[st]) out[st].push({ id: def.id, title: def.title, line: $.quest.line(def.id) });
        }
        $.store.set('journal', out);
        return out;
    };
    return $.updateFor(node, (dt) => {
        if ($.input.pressed(config.key)) $.emit('journal:open', build());
        t -= dt * 1000;
        if (t > 0) return;
        t = config.every;
        $.emit('journal', build());
    });
}
