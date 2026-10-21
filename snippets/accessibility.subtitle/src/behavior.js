// Субтитры: строка внизу по событиям $.dialog line и глобальному subtitle { text }.
export default function subtitles(node, config, $) {
    const doc = $.ui.markup('snippets/subtitles.rml', '<rml><head><style>body { width: 100%; height: 100%; } #s { position: absolute; left: 10%; bottom: 40px; width: 80%; text-align: center; color: #ffffff; font-size: ' + config.size + 'px; background-color: rgba(0,0,0,' + Math.round(config.background * 255) + '); }</style></head><body><div id="s"></div></body></rml>');
    doc.show();
    let left = 0;
    const show = (text, ms) => { doc.text('s', String(text).replace(/</g, '&lt;')); left = ms; };
    const onLine = (e) => show((config.speaker && e.speaker ? e.speaker + ': ' : '') + (e.fullText || e.text || ''), 4000);
    const onSub = (e) => show(e.data && e.data.text || '', (e.data && e.data.ms) || 2500);
    $.dialog.on('line', onLine);
    $.on('subtitle', onSub);
    const stop = $.updateFor(node, (dt) => { if (left <= 0) return; left -= dt * 1000; if (left <= 0) doc.text('s', ''); });
    return () => { stop(); $.dialog.off('line', onLine); $.off('subtitle', onSub); doc.unload(); };
}
