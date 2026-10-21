// Метка: узел-ромб над целью; за экраном прижимается к краю камеры.
export default function worldMarker(node, config, $) {
    const m = $('<marker>').size(config.size, config.size).angle(45).color(config.color).hide().appendTo($.world);
    const stop = $.updateFor(node, (dt, self) => {
        const on = config.quest && $.quest.status(config.quest) === 'active';
        if (!on) { m.hide(); return; }
        const p = self.pos();
        let x = p.x, y = p.y - self.height() / 2 - config.size;
        if (config.edge && !$.camera.isOnScreen(self, 0)) {
            const v = $.camera.viewport();
            x = Math.max(v.x + config.size, Math.min(v.x + v.w - config.size, x));
            y = Math.max(v.y + config.size, Math.min(v.y + v.h - config.size, y));
        }
        m.at(x, y).show();
    });
    return () => { stop(); m.remove(); };
}
