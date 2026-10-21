
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function interactionPrompt(node, config, $) {
    const doc = hud($, 'ui-prompt', '<div id="p" class="panel" style="left: 40%; bottom: ' + config.bottom + 'px; width: 20%; text-align: center;"></div>');
    doc.hide();
    const on = (e) => { const t = e.data && e.data.text; if (t) { doc.text('p', esc(t)); doc.show(); } else doc.hide(); };
    $.on('interact:prompt', on);
    return () => { $.off('interact:prompt', on); doc.unload(); };
}
