
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function weaponPanel(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const doc = hud($, 'ui-weapon', '<div class="panel" style="left: ' + config.position[0] + 'px; top: ' + config.position[1] + 'px;"><span id="w"></span></div>');
    let last = '';
    const stop = $.updateFor(node, () => {
        const w = sel(config.who), gun = w.length ? $.weapons.of(w) : null;
        const text = gun ? (gun.id + ' · ' + gun.mode + ' · ' + gun.magazine + '/' + gun.capacity + (w.data('ammoReserve') !== undefined ? ' (' + w.data('ammoReserve') + ')' : '')) : '—';
        if (text !== last) { last = text; doc.text('w', esc(text)); }
    });
    return () => { stop(); doc.unload(); };
}
