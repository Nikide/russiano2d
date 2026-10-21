
// Полноэкранный оверлей RmlUi из строки разметки (закон UI: интерфейс — RmlUi).
function overlay($, name, body, style) {
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>body { width: 100%; height: 100%; margin: 0px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    return doc;
}

export default function vignette(node, config, $) {
    const e = config.edge, side = (pos) => '<div class="v" style="' + pos + '"></div>';
    const doc = overlay($, 'vignette',
        side('left: 0px; top: 0px; width: 100%; height: ' + e + 'px;') + side('left: 0px; bottom: 0px; width: 100%; height: ' + e + 'px;') +
        side('left: 0px; top: 0px; width: ' + e + 'px; height: 100%;') + side('right: 0px; top: 0px; width: ' + e + 'px; height: 100%;'),
        '.v { position: absolute; background-color: #000000; opacity: ' + config.amount + '; }');
    doc.show();
    return () => doc.unload();
}
