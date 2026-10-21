// Патруль: точки маршрута по кругу; без точек — разворот у стены.
function parsePoints(text) {
    return String(text || '').split(';').map((p) => p.split(',').map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => ({ x, y }));
}

export default function waypointPatrol(node, config, $) {
    const points = parsePoints(config.points);
    let index = 0, wait = 0, dir = 1;
    return $.updateFor(node, (dt, self) => {
        if (!points.length) {
            if (self.onWall()) dir = -dir;
            self.velocity(dir * config.speed, self.velocity().y);
            return;
        }
        if (wait > 0) { wait -= dt * 1000; self.velocity(0, self.velocity().y); return; }
        const p = self.pos(), t = points[index];
        if (Math.hypot(t.x - p.x, t.y - p.y) <= config.reach) {
            index = (index + 1) % points.length;
            wait = config.pause;
            return;
        }
        self.moveTowards(t, config.speed);
    });
}
