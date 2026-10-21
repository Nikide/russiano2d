
// Полноэкранный оверлей RmlUi из строки разметки (закон UI: интерфейс — RmlUi).
function overlay($, name, body, style) {
    const doc = $.ui.markup('snippets/' + name + '.rml', '<rml><head><style>body { width: 100%; height: 100%; margin: 0px; } ' + (style || '') + '</style></head><body>' + body + '</body></rml>');
    return doc;
}

// Тост: очередь сообщений, одно на экране.
function toaster($, name, color) {
    const doc = overlay($, name, '<div id="t"></div>', '#t { position: absolute; left: 50%; top: 40px; margin-left: -220px; width: 440px; padding: 10px; text-align: center; color: #ffffff; font-size: 18px; background-color: ' + color + '; opacity: 0; }');
    doc.show();
    const queue = [];
    let left = 0;
    return {
        push(text, ms) { queue.push([text, ms]); },
        tick(dt) {
            if (left > 0) { left -= dt * 1000; if (left <= 0) doc.style('t', 'opacity', '0'); return; }
            const next = queue.shift();
            if (!next) return;
            doc.text('t', next[0]); doc.style('t', 'opacity', '1'); left = next[1];
        },
        unload() { doc.unload(); },
    };
}

export default function errorPrompt(node, config, $) {
    const t = toaster($, 'error-prompt', '#502020');
    const hs = config.messages.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, txt]) => [ev.trim(), () => { t.push(txt.trim(), config.ms); $.emit('ui:deny', {}); }]);
    for (const [ev, h] of hs) { $.on(ev, h); node.on(ev, h); }
    const stop = $.updateFor(node, (dt) => t.tick(dt));
    return () => { stop(); for (const [ev, h] of hs) { $.off(ev, h); node.off(ev, h); } t.unload(); };
}
