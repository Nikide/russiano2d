
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

export default function inventoryScreen(node, config, $) {
    const doc = hud($, 'ui-inventory', '<div id="inv" class="panel" style="left: 30%; top: 15%; width: 40%; height: 70%;"><div id="title">Инвентарь</div><div id="list"></div></div>', '.row { display: block; padding: 3px; } .row:hover { background-color: #2a3240; }');
    doc.hide();
    let open = false;
    const render = () => {
        const bag = bagOf($(config.who));
        const items = bag ? Object.entries(bag.summary()) : [];
        doc.html('list', items.map(([id, n]) => { const d = $.items.get(id) || {}; return '<div class="row" data-key="' + esc(id) + '">' + esc(d.title || id) + ' ×' + n + '</div>'; }).join('') || '<div class="row">пусто</div>');
    };
    doc.on('list', 'click', (id, ev, key) => {
        if (!key) return;
        const w = $(config.who), d = $.items.get(key) || {};
        if (d.wear) w.emit('equip', { item: key });
        else if (d.kind === 'weapon') w.emit('equip-weapon', { item: key });
        else w.data('activeItem', key);
        $.emit('ui:select', {});
        render();
    });
    const stop = $.updateFor(node, () => {
        if (!$.input.pressed(config.key)) return;
        open = !open;
        if (open) { render(); doc.show(); } else doc.hide();
    });
    return () => { stop(); doc.unload(); };
}
