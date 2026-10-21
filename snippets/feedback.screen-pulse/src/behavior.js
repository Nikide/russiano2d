
// Полноэкранный оверлей RmlUi из строки разметки (закон UI: интерфейс — RmlUi).
function overlay($, name, body, style) {
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>body { width: 100%; height: 100%; margin: 0px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    return doc;
}

export default function screenPulse(node, config, $) {
    const doc = overlay($, 'pulse', '<div id="ring"></div>', '#ring { position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; border-width: 18px; border-color: ' + config.color + '; opacity: 0; }');
    doc.show();
    let left = 0;
    const go = () => { left = config.ms; };
    $.on(config.event, go);
    const stop = $.updateFor(node, (dt) => { if (left <= 0) return; left -= dt * 1000; doc.style('ring', 'opacity', String(Math.max(0, left / config.ms))); });
    return () => { stop(); $.off(config.event, go); doc.unload(); };
}
