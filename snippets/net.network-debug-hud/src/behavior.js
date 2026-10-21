// Отладка: строка $.net.describe() и RTT peers раз в 250 мс.
export default function networkDebugHud(node, config, $) {
    const doc = $.ui.markup('snippets/net-debug.rml', '<rml><head><style>body { width: 100%; height: 100%; } #n { position: absolute; right: 10px; top: 10px; padding: 6px; background-color: #000000; color: #80ff80; font-family: RobotoMono; font-size: 12px; }</style></head><body><div id="n"></div></body></rml>');
    doc.hide();
    let on = false, t = 0;
    const stop = $.updateFor(node, (dt) => {
        if ($.input.pressed(config.key)) { on = !on; if (on) doc.show(); else doc.hide(); }
        if (!on) return;
        t -= dt * 1000;
        if (t > 0) return;
        t = 250;
        const peers = $.net.peers().map((p) => p.id + ':' + Math.round(p.rtt || 0) + 'ms').join(' ');
        doc.text('n', String($.net.describe()) + (peers ? ' · ' + peers : ''));
    });
    return () => { stop(); doc.unload(); };
}
