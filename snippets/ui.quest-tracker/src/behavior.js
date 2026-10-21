
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function questTracker(node, config, $) {
    const doc = hud($, 'ui-tracker', '<div class="panel" style="left: ' + config.position[0] + 'px; top: ' + config.position[1] + 'px; width: 280px;"><div id="t"></div></div>');
    let last = '';
    const stop = $.updateFor(node, () => {
        const id = config.quest || ($.quest.definitions().find((d) => $.quest.status(d.id) === 'active') || {}).id;
        const text = id ? $.quest.line(id) : '';
        if (text !== last) { last = text; doc.text('t', esc(text)); }
    });
    return () => { stop(); doc.unload(); };
}
