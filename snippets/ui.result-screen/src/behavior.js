
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function resultScreen(node, config, $) {
    const doc = hud($, 'ui-result', '<div id="r" class="panel" style="left: 35%; top: 25%; width: 30%; text-align: center;"><div>Уровень пройден</div><div id="s"></div><div class="b" data-key="retry">Заново</div><div class="b" data-key="next">Дальше</div></div>', '.b { display: block; padding: 6px; }');
    doc.hide();
    const show = (e) => { const r = e.data || {}; doc.text('s', 'Время: ' + ((r.time || 0) / 1000).toFixed(1) + ' с · тайники: ' + (r.secrets || 0)); doc.show(); };
    doc.on('r', 'click', (id, ev, key) => {
        doc.hide();
        if (key === 'retry' && config.retryScene) $.scene.load(config.retryScene);
        if (key === 'next' && config.nextScene) $.scene.load(config.nextScene);
    });
    $.on('level:complete', show);
    return () => { $.off('level:complete', show); doc.unload(); };
}
