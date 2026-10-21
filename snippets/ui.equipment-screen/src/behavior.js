
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

export default function equipmentScreen(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const doc = hud($, 'ui-equipment', '<div class="panel" style="left: 20%; top: 15%; width: 30%;"><div>Экипировка</div><div id="worn"></div><div id="cmp"></div></div>');
    doc.hide();
    let open = false;
    const render = () => {
        const bag = bagOf(sel(config.who));
        if (!bag) return;
        doc.html('worn', bag.wornList().map((x) => '<div>' + esc((x.slot || '') + ': ' + (($.items.get(x.id) || {}).title || x.id)) + '</div>').join('') || '<div>ничего не надето</div>');
        doc.text('cmp', 'Класс брони: ' + bag.armorClass());
    };
    const stop = $.updateFor(node, () => {
        if (!$.input.pressed(config.key)) return;
        open = !open;
        if (open) { render(); doc.show(); } else doc.hide();
    });
    return () => { stop(); doc.unload(); };
}
