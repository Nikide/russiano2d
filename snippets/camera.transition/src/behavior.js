// Переход: panTo к цели, затем follow.
export default function cameraTransition(node, config, $) {
    const handlers = config.cues.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, sel]) => [ev.trim(), () => {
        const t = $(sel.trim());
        if (!t.length) return;
        const p = t.pos();
        $.camera.unfollow();
        $.camera.panTo(p.x, p.y, config.ms);
        $.time.wait(config.ms).then(() => $.camera.follow(sel.trim()));
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
