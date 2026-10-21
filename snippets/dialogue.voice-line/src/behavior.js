// Озвучка: line → $.audio.play; хэндл прежней реплики останавливается.
export default function voiceLine(node, config, $) {
    const map = Object.fromEntries(config.lines.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    let handle = null;
    const stopVoice = () => { if (handle && handle.stop) handle.stop(); handle = null; };
    const onLine = (e) => { stopVoice(); const src = map[e.data.id + ':' + e.data.page] || map[e.data.id]; if (src) handle = $.audio.play(src, { bus: config.bus }); };
    $.dialog.on('line', onLine);
    $.dialog.on('end', stopVoice);
    return () => { $.dialog.off('line', onLine); $.dialog.off('end', stopVoice); stopVoice(); };
}
