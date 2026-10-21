
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function confirmDialog(node, config, $) {
    const doc = hud($, 'ui-confirm', '<div id="d" class="panel" style="left: 35%; top: 35%; width: 30%; text-align: center;"><div id="q"></div><span class="b" data-key="yes">' + esc(config.yesText) + '</span> <span class="b" data-key="no">' + esc(config.noText) + '</span></div>', '.b { padding: 6px; }');
    doc.hide();
    let pending = null;
    const ask = (e) => { pending = e.data || {}; doc.text('q', esc(pending.text || 'Вы уверены?')); doc.show(); };
    doc.on('d', 'click', (id, ev, key) => {
        if (!pending || (key !== 'yes' && key !== 'no')) return;
        const ev2 = key === 'yes' ? pending.yes : pending.no;
        pending = null; doc.hide();
        if (ev2) $.emit(ev2, {});
    });
    $.on('confirm', ask);
    return () => { $.off('confirm', ask); doc.unload(); };
}
