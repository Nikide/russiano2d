// Варианты уходят в dialogue.tree событием dialogue:choices (порядок подключения не важен).
export default function dialogueChoice(node, config, $) {
    const options = config.options.map((s) => s.split('|').map((x) => (x || '').trim())).filter(([text]) => text)
        .map(([text, to, flag]) => Object.assign({ text, to: to || null, action: text }, flag ? { if: flag } : {}));
    const send = () => $.emit('dialogue:choices', { dialog: config.dialog, line: config.line, options });
    const onDefined = (e) => { if (e.data && e.data.id === config.dialog) send(); };
    const onChoice = (e) => { if (config.record && $.dialog.definition() === config.dialog && options.some((o) => o.text === e.text)) $.story.set(config.record, e.text); };
    $.on('dialogue:defined', onDefined);
    $.dialog.on('choice', onChoice);
    send();
    return () => { $.off('dialogue:defined', onDefined); $.dialog.off('choice', onChoice); };
}
