
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

export default function questToast(node, config, $) {
    const t = toaster($, 'quest-toast', config.color);
    const hs = [
        ['quest:started', (e) => t.push('Новое задание: ' + ((($.quest.def(e.data.quest) || {}).title) || e.data.quest), config.ms)],
        ['quest:ready', (e) => t.push('Цель выполнена: ' + ((($.quest.def(e.data.quest) || {}).title) || e.data.quest), config.ms)],
        ['quest:failed', (e) => t.push('Задание провалено', config.ms)],
        ['reward', () => t.push('Получена награда', config.ms)],
    ];
    for (const [ev, h] of hs) $.on(ev, h);
    const stop = $.updateFor(node, (dt) => t.tick(dt));
    return () => { stop(); for (const [ev, h] of hs) $.off(ev, h); t.unload(); };
}
