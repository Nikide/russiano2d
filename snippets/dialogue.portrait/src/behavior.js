// Портрет: событие line → подходящая картинка в узле интерфейса.
export default function dialoguePortrait(node, config, $) {
    const map = Object.fromEntries(config.portraits.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    const pic = $('<portrait>', { ui: true }).at(config.position[0], config.position[1]).size(config.size[0], config.size[1]).hide().appendTo($.world);
    const onLine = (e) => {
        const key = (e.speaker || '') + ':' + ((e.text || '').match(/^\[(\w+)\]/) || [])[1];
        const src = map[key] || map[(e.speaker || '') + ':'] || map[e.speaker] || e.portrait;
        if (src) pic.sprite(src).show(); else pic.hide();
    };
    const onEnd = () => pic.hide();
    $.dialog.on('line', onLine);
    $.dialog.on('end', onEnd);
    return () => { $.dialog.off('line', onLine); $.dialog.off('end', onEnd); pic.remove(); };
}
