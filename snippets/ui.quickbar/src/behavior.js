
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function quickbarUi(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const doc = hud($, 'ui-quickbar', '<div id="q" class="panel" style="left: ' + config.position[0] + 'px; top: ' + config.position[1] + 'px;"></div>', '.slot { display: inline-block; width: 64px; margin-right: 4px; text-align: center; } .slot.on { color: #ffd040; }');
    let last = '';
    const stop = $.updateFor(node, () => {
        const w = sel(config.who), slots = w.data('quickbar') || [], bag = bagOf(w), active = w.data('activeItem');
        const html = slots.map((id, i) => '<span class="slot' + (id === active ? ' on' : '') + '">' + (i + 1) + ': ' + esc(id) + ' ×' + (bag ? bag.count(id) : 0) + '</span>').join('');
        if (html !== last) { last = html; doc.html('q', html); }
    });
    return () => { stop(); doc.unload(); };
}
