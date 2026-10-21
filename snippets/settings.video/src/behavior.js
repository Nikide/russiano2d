// Видео: $.window и $.ui.scale; событие video:set { key, value }.
export default function settingsVideo(node, config, $) {
    const apply = () => {
        const s = $.store.get('video', {});
        $.window.fullscreen(s.fullscreen ?? config.fullscreen);
        if (!(s.fullscreen ?? config.fullscreen)) $.window.size(...(s.size || config.size));
        $.window.vsync(s.vsync ?? config.vsync);
        $.ui.scale(s.uiScale ?? config.uiScale);
    };
    apply();
    const on = (e) => { const d = e.data || {}; if (!d.key) return; const s = $.store.get('video', {}); s[d.key] = d.value; $.store.set('video', s); apply(); };
    $.on('video:set', on);
    return () => $.off('video:set', on);
}
