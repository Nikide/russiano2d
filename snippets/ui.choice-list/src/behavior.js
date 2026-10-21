
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function choiceList(node, config, $) {
    const doc = hud($, 'ui-choices', '<div id="c" class="panel" style="left: ' + (config.position[0] - 200) + 'px; top: ' + config.position[1] + 'px; width: 400px;"></div>', '.ch { display: block; padding: 6px; } .ch:hover { background-color: #2a3240; }');
    doc.hide();
    let last = '';
    doc.on('c', 'click', (id, ev, key) => { if (key !== undefined && key !== '') { $.dialog.choose(Number(key)); $.emit('ui:select', {}); } });
    const stop = $.updateFor(node, () => {
        const list = $.dialog.isOpen() && !$.dialog.isTyping() ? $.dialog.choices() : [];
        const html = list.map((c, i) => '<div class="ch" data-key="' + i + '">' + esc(c.text) + '</div>').join('');
        if (html === last) return;
        last = html;
        if (html) { doc.html('c', html); doc.show(); } else doc.hide();
    });
    return () => { stop(); doc.unload(); };
}
