
// Полноэкранный оверлей RmlUi из строки разметки (закон UI: интерфейс — RmlUi).
function overlay($, name, body, style) {
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>body { width: 100%; height: 100%; margin: 0px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    return doc;
}

export default function renderFade(node, config, $) {
    const doc = overlay($, 'fade', '<div id="veil"></div>', '#veil { position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; background-color: ' + config.color + '; opacity: 0; }');
    doc.show();
    let a = 0, target = 0;
    const out = () => { target = 1; }, inn = () => { target = 0; };
    $.on(config.outEvent, out);
    $.on(config.inEvent, inn);
    const stop = $.updateFor(node, (dt) => {
        if (a === target) return;
        const step = config.ms ? dt * 1000 / config.ms : 1;
        a = target > a ? Math.min(target, a + step) : Math.max(target, a - step);
        doc.style('veil', 'opacity', String(a));
        if (a === target) $.emit(target ? 'fade:done-out' : 'fade:done-in', {});
    });
    return () => { stop(); $.off(config.outEvent, out); $.off(config.inEvent, inn); doc.unload(); };
}
