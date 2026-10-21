// История: [{ dialog, node, text }] в $.save.set(key) — переживает сейв.
export default function choiceHistory(node, config, $) {
    const log = ($.save.get(config.key) || []).slice();
    const on = (e) => {
        log.push({ dialog: $.dialog.definition(), node: $.dialog.node(), text: e.text });
        while (log.length > config.keep) log.shift();
        $.save.set(config.key, log);
    };
    $.dialog.on('choice', on);
    return () => $.dialog.off('choice', on);
}
