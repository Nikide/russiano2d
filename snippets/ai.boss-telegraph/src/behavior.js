// Телеграф: зона на позиции цели заранее; по истечении — урон всем внутри.
export default function bossTelegraph(node, config, $) {
    let t = config.interval;
    return $.updateFor(node, (dt, self) => {
        t -= dt * 1000;
        if (t > 0) return;
        t = config.interval;
        const tg = $(config.target);
        if (!tg.length) return;
        const q = tg.pos(), r = config.radius;
        const zone = $('<telegraph>').at(q.x, q.y).size(r * 2, r * 2).color(config.color).alpha(0.3).appendTo($.world);
        self.emit('telegraph', { x: q.x, y: q.y, radius: r });
        let w = config.warn;
        $.updateFor(zone, (d, z) => {
            w -= d * 1000;
            z.alpha(0.3 + 0.5 * (1 - w / config.warn));
            if (w > 0) return;
            for (const n of $.world.query(q.x, q.y, r).nodes) if (n === tg.get(0)) tg.damage(config.damage, self, 'boss');
            z.remove();
        });
    });
}
