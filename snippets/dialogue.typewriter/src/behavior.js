// Печать: $.dialog.speed; звук — по приросту видимого текста.
export default function typewriter(node, config, $) {
    $.dialog.speed(config.speed);
    let shown = 0;
    const stop = $.updateFor(node, () => {
        if (!$.dialog.isOpen() || !$.dialog.isTyping()) { shown = 0; return; }
        const n = ($.dialog.text() || '').length;
        if (config.blip && Math.floor(n / config.every) > Math.floor(shown / config.every)) $.audio.play(config.blip);
        shown = n;
    });
    return stop;
}
