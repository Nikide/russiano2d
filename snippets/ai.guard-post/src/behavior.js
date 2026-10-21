// Пост: цель внутри радиуса от поста — преследование; иначе — к посту.
export default function guardPost(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const post = node.pos();
    let alert = false;
    return $.updateFor(node, (dt, self) => {
        const tg = sel(config.target);
        const inside = tg.length && Math.hypot(tg.pos().x - post.x, tg.pos().y - post.y) <= config.radius;
        if (inside !== alert) { alert = inside; self.emit(alert ? 'guard:alert' : 'guard:calm', {}); }
        if (alert) { self.moveTowards(tg, config.speed); return; }
        const p = self.pos();
        if (Math.hypot(p.x - post.x, p.y - post.y) > 4) self.moveTowards(post, config.speed); else self.velocity(0, self.velocity().y);
    });
}
