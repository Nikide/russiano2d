// Фон: два слоя-картинки; новый проявляется поверх старого.
export default function vnBackground(node, config, $) {
    let cur = null;
    const handlers = config.backgrounds.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, src]) => [ev.trim(), () => {
        const next = $('<background>').at(config.size[0] / 2, config.size[1] / 2).size(config.size[0], config.size[1]).sprite(src.trim()).alpha(0).appendTo($.world);
        const old = cur; cur = next;
        next.fadeTo(1, config.fade).then(() => { if (old) old.remove(); });
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); if (cur) cur.remove(); };
}
