// Действия: choice по тексту и line по id реплики → $.emit(событие).
export default function dialogueAction(node, config, $) {
    const map = Object.fromEntries(config.actions.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    const onChoice = (e) => { if ($.dialog.definition() !== config.dialog) return; if (config.setFlag) $.story.set(config.setFlag, e.text); if (map[e.text]) $.emit(map[e.text], { dialog: config.dialog }); };
    const onLine = (e) => { if (e.definition === config.dialog && map[e.id]) $.emit(map[e.id], { dialog: config.dialog }); };
    $.dialog.on('choice', onChoice);
    $.dialog.on('line', onLine);
    return () => { $.dialog.off('choice', onChoice); $.dialog.off('line', onLine); };
}
