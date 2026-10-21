
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function questJournalUi(node, config, $) {
    const doc = hud($, 'ui-journal', '<div class="panel" style="left: 25%; top: 10%; width: 50%; height: 80%;"><div id="tabs"><span data-key="active">Активные</span> · <span data-key="ready">Готовые</span> · <span data-key="done">Выполненные</span></div><div id="list"></div></div>');
    doc.hide();
    let open = false, filter = 'active';
    const render = () => doc.html('list', $.quest.definitions().filter((d) => $.quest.status(d.id) === filter).map((d) => '<div>' + esc($.quest.line(d.id) || d.title || d.id) + '</div>').join('') || '<div>нет</div>');
    doc.on('tabs', 'click', (id, ev, key) => { if (key) { filter = key; render(); } });
    const stop = $.updateFor(node, () => {
        if (!$.input.pressed(config.key)) return;
        open = !open;
        if (open) { render(); doc.show(); } else doc.hide();
    });
    return () => { stop(); doc.unload(); };
}
