// Толкание: актор рядом и движется в сторону объекта → сдвиг, если $.world.castShape свободен.
export default function pushable(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.actor);
        if (!who.length) return;
        const p = self.pos(), q = who.pos(), v = who.velocity();
        const gapX = Math.abs(p.x - q.x) - (self.width() + who.width()) / 2;
        if (gapX > config.contact || Math.abs(p.y - q.y) > (self.height() + who.height()) / 2) return;
        const dir = Math.sign(p.x - q.x);
        if (!dir || Math.sign(v.x) !== dir) return;
        const step = dir * config.speed * dt;
        const to = { x: p.x + step, y: p.y };
        const hit = $.world.castShape(p, to, { w: self.width() - 2, h: self.height() - 2, ignore: [self, who] });
        if (hit && hit.fraction < 1) return;
        self.at(to.x, to.y);
        self.emit('pushed', { dir });
    });
}
