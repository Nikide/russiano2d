// Поиск: точки по кругу вокруг lastKnown; найдено (sees) — прервать; конец — search:give-up.
export default function search(node, config, $) {
    let pts = [], i = 0, wait = 0;
    const begin = () => {
        const lk = node.data('lastKnown');
        if (!lk) return;
        pts = Array.from({ length: config.points }, (_, k) => ({
            x: lk.x + Math.cos(k / config.points * Math.PI * 2) * config.radius,
            y: lk.y + Math.sin(k / config.points * Math.PI * 2) * config.radius }));
        i = 0; wait = 0;
        node.emit('search:start', {});
    };
    node.on('investigate:done', begin);
    const stop = $.updateFor(node, (dt, self) => {
        if (!pts.length) return;
        if (self.data('sees')) { pts = []; self.emit('search:found', {}); return; }
        if (wait > 0) { wait -= dt * 1000; return; }
        const p = self.pos(), t = pts[i];
        if (Math.hypot(t.x - p.x, t.y - p.y) > 6) { self.moveTowards(t, config.speed); return; }
        wait = config.pause;
        if (++i >= pts.length) { pts = []; self.emit('search:give-up', {}); }
    });
    return () => { stop(); node.off('investigate:done', begin); };
}
