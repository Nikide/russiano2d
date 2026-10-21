// Подсказка: один текстовый узел, переезжает к ближайшему объекту с data('prompt').
export default function contextPrompt(node, config, $) {
    const label = $('<text>', { text: '', size: config.size }).color(config.color).hide().appendTo($.world);
    const stop = $.updateFor(node, (dt, self) => {
        let best = null;
        $(config.targets).each((i, t) => { const d = self.distanceTo(t); if (d <= config.radius && t.data('prompt') && (!best || d < best.d)) best = { t, d }; });
        if (!best) { label.hide(); return; }
        const p = best.t.pos();
        label.text(String(best.t.data('prompt'))).at(p.x, p.y - best.t.height() / 2 - 12).show();
    });
    return () => { stop(); label.remove(); };
}
