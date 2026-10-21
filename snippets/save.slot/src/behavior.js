// Слоты: meta.time — время игры на момент сохранения.
export default function saveSlot(node, config, $) {
    const save = (e) => { const n = Number(e.data && e.data.n) || 1; if (n > config.slots) return; $.save.slot(n).save({ meta: { time: Math.round($.time.now()), slot: n } }); $.emit('saved', { slot: n }); };
    const load = (e) => { const n = Number(e.data && e.data.n) || 1; if (n <= config.slots && $.save.slot(n).load()) $.emit('loaded', { slot: n }); };
    $.on('save:slot', save);
    $.on('load:slot', load);
    if (config.autosave) $.save.autosave(config.autosave);
    return () => { $.off('save:slot', save); $.off('load:slot', load); if (config.autosave) $.save.stopAutosave(); };
}
