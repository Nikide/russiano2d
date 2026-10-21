// Портрет диалога — RmlUi, в координатах экрана.
export default function dialoguePortrait(node, config, $) {
    const map = Object.fromEntries(config.portraits.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    // Имя в корне игры: src изображения остаётся project-relative.
    const doc = $.ui.markup('snippets-portrait-' + node.attr('id') + '.rml', '<rml><head><style>body { margin: 0px; width: 100%; height: 100%; } #portrait { position: absolute; left: ' + (config.position[0] - config.size[0] / 2) + 'px; top: ' + (config.position[1] - config.size[1] / 2) + 'px; width: ' + config.size[0] + 'px; height: ' + config.size[1] + 'px; }</style></head><body><img id="portrait"/></body></rml>');
    doc.hide();
    const onLine = (e) => {
        const key = (e.speaker || '') + ':' + ((e.text || '').match(/^\[(\w+)\]/) || [])[1];
        const src = map[key] || map[(e.speaker || '') + ':'] || map[e.speaker] || e.portrait;
        if (src) { doc.attr('portrait', 'src', src); doc.show(); } else doc.hide();
    };
    const onEnd = () => doc.hide();
    $.dialog.on('line', onLine);
    $.dialog.on('end', onEnd);
    return () => { $.dialog.off('line', onLine); $.dialog.off('end', onEnd); doc.unload(); };
}
