
// HUD — документ RmlUi из строки ($.ui.markup): закон UI проекта, без второго UI-слоя.
const BASE = 'body { width: 100%; height: 100%; margin: 0px; font-family: LatoLatin; color: #ffffff; } .panel { position: absolute; padding: 6px; background-color: #10141c; opacity: 0.85; } .bar { height: 10px; background-color: #333a46; } .fill { height: 10px; }';
function hud($, name, body, style) {
    const scale = Number($.store.get('textScale', 1)) || 1;
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>' + BASE + ' body { font-size: ' + Math.round(14 * scale) + 'px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    doc.show();
    return doc;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function pauseMenu(node, config, $) {
    const doc = hud($, 'ui-pause', '<div id="m" class="panel" style="left: 40%; top: 30%; width: 20%; text-align: center;"><div>Пауза</div><div class="b" data-key="resume">Продолжить</div><div class="b" data-key="settings">Настройки</div><div class="b" data-key="quit">В меню</div></div>', '.b { display: block; padding: 8px; } .b:hover { background-color: #2a3240; }');
    doc.hide();
    let open = false;
    const set = (v) => { open = v; if (v) { $.time.pause(); doc.show(); } else { $.time.resume(); doc.hide(); } $.emit(v ? 'pause' : 'resume', {}); };
    doc.on('m', 'click', (id, ev, key) => {
        if (key === 'resume') set(false);
        else if (key === 'settings') $.emit('settings:open', {});
        else if (key === 'quit') { set(false); if (config.menuScene) $.scene.load(config.menuScene); }
    });
    const stop = $.updateFor(node, () => { if ($.input.pressed(config.key)) set(!open); });
    return () => { stop(); if (open) $.time.resume(); doc.unload(); };
}
