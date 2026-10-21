
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function settingsMenu(node, config, $) {
    const doc = hud($, 'ui-settings', '<div id="s" class="panel" style="left: 35%; top: 20%; width: 30%;"><div>Настройки</div>'
        + '<div>Громкость <input id="vol" type="range" min="0" max="1" step="0.05" value="' + $.store.get('volume', 1) + '"/></div>'
        + '<div>Масштаб UI <input id="ui" type="range" min="0.5" max="2" step="0.1" value="' + $.store.get('uiScale', 1) + '"/></div>'
        + '<div class="b" data-key="fs">Полный экран</div><div class="b" data-key="close">Закрыть</div></div>', '.b { display: block; padding: 6px; } input { width: 60%; }');
    doc.hide();
    const open = () => doc.show();
    doc.on('s', 'change', () => {
        const v = Number(doc.value('vol')), u = Number(doc.value('ui'));
        if (Number.isFinite(v)) { $.audio.masterVolume(v); $.store.set('volume', v); }
        if (Number.isFinite(u)) { $.ui.scale(u); $.store.set('uiScale', u); }
    });
    doc.on('s', 'click', (id, ev, key) => { if (key === 'fs') $.window.toggleFullscreen(); else if (key === 'close') doc.hide(); });
    $.on(config.openEvent, open);
    return () => { $.off(config.openEvent, open); doc.unload(); };
}
