
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function dialogueBox(node, config, $) {
    const doc = hud($, 'ui-dialogue', '<div class="panel" style="left: 5%; bottom: 20px; width: 90%; height: ' + config.height + 'px;"><div id="who" style="color: #ffd040;"></div><div id="text"></div></div>');
    doc.hide();
    const onLine = (e) => { doc.text('who', esc(e.data.speaker || '')); doc.show(); };
    const onEnd = () => doc.hide();
    $.dialog.on('line', onLine);
    $.dialog.on('end', onEnd);
    const stop = $.updateFor(node, () => { if ($.dialog.isOpen()) doc.text('text', esc($.dialog.text() || '')); });
    return () => { stop(); $.dialog.off('line', onLine); $.dialog.off('end', onEnd); doc.unload(); };
}
