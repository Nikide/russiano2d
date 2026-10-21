// Паника: ближайшая опасность или $.emit('explosion') рядом → бегство, класс panic.
export default function civilianPanic(node, config, $) {
    let fear = 0, from = null;
    const boom = (e) => { const d = e.data || {}; const p = node.pos(); if (Math.hypot(d.x - p.x, d.y - p.y) <= config.radius * 2) { fear = config.calm; from = { x: d.x, y: d.y }; } };
    $.on('explosion', boom);
    const stop = $.updateFor(node, (dt, self) => {
        const p = self.pos();
        $(config.danger).each((i, d) => { if (self.distanceTo(d) <= config.radius) { fear = config.calm; from = d.pos(); } });
        if (fear <= 0) { if (self.hasClass('panic')) { self.removeClass('panic'); self.emit('calm', {}); } return; }
        fear -= dt * 1000;
        if (!self.hasClass('panic')) { self.addClass('panic'); self.emit('panic', {}); }
        const dx = p.x - from.x, dy = p.y - from.y, l = Math.hypot(dx, dy) || 1;
        self.velocity(dx / l * config.speed, dy / l * config.speed);
    });
    return () => { stop(); $.off('explosion', boom); };
}
