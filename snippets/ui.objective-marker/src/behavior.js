
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function objectiveMarker(node, config, $) {
    const doc = hud($, 'ui-objective', '<div id="m" style="position: absolute; width: 16px; height: 16px; background-color: ' + config.color + ';"></div>');
    const stop = $.updateFor(node, () => {
        const t = $(config.targets).first();
        if (!t.length || $.camera.isOnScreen(t, 0)) { doc.style('m', 'display', 'none'); return; }
        const s = $.camera.worldToScreen(t.pos()), W = 1280, H = 720;
        const x = Math.max(8, Math.min(W - 24, s.x)), y = Math.max(8, Math.min(H - 24, s.y));
        doc.style('m', 'display', 'block'); doc.style('m', 'left', x + 'px'); doc.style('m', 'top', y + 'px');
    });
    return () => { stop(); doc.unload(); };
}
