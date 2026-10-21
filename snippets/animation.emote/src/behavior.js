// Эмоция: текстовый узел с иконкой Material ($.ui.icon) или символом над головой.
export default function emote(node, config, $) {
    let label = null, left = 0;
    const on = (e) => {
        const ic = e.data && e.data.icon || '!';
        if (!label) label = $('<text>', { text: '', size: config.size }).appendTo($.world);
        label.text($.ui.hasIcon(ic) ? $.ui.icon(ic) : ic).show();
        left = config.ms;
    };
    node.on('emote', on);
    const stop = $.updateFor(node, (dt, self) => {
        if (!label || left <= 0) return;
        left -= dt * 1000;
        const p = self.pos();
        label.at(p.x, p.y - self.height() / 2 - config.size);
        if (left <= 0) label.hide();
    });
    return () => { stop(); node.off('emote', on); if (label) label.remove(); };
}
