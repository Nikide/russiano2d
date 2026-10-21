
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function bar(node, config, $) {
    const doc = hud($, 'ui.shield-bar', '<div class="panel" style="left: ' + config.position[0] + 'px; top: ' + config.position[1] + 'px; width: ' + config.width + 'px;"><div class="bar"><div id="fill" class="fill" style="width: 100%; background-color: ' + config.color + ';"></div></div></div>');
    let last = -1;
    const stop = $.updateFor(node, () => {
        const w = $(config.who);
        if (!w.length) return;
        const value = Number(w.data('shield')) || 0, max = config.capacity;
        const k = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        if (Math.abs(k - last) < 0.001) return;
        last = k;
        doc.style('fill', 'width', (k * 100).toFixed(1) + '%');
    });
    return () => { stop(); doc.unload(); };
}
