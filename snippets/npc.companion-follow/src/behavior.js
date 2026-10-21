// Следование с гистерезисом near/far; вне экрана — телепорт к лидеру.
export default function companionFollow(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let moving = false;
    return $.updateFor(node, (dt, self) => {
        if (self.data('command') && self.data('command') !== 'follow') return;
        const l = sel(config.leader);
        if (!l.length) return;
        const d = self.distanceTo(l);
        if (config.teleportOffscreen && !$.camera.isOnScreen(self) && d > config.far * 2) { const p = l.pos(); self.at(p.x - config.near, p.y); return; }
        if (d > config.far) moving = true; else if (d < config.near) moving = false;
        if (moving) self.moveTowards(l, config.speed); else self.velocity(0, self.velocity().y);
    });
}
