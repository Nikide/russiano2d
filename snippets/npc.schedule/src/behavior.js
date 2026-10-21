
// Игровые часы: час суток из игрового времени ($.time.now) и длины суток.
function hourNow($, dayLength) { return (($.time.now() / 1000) % dayLength) / dayLength * 24; }

export default function schedule(node, config, $) {
    const plan = config.entries.map((s) => s.split('=')).map(([h, xy]) => [Number(h), (xy || '').split(',').map(Number)])
        .filter(([h, p]) => Number.isFinite(h) && p.length === 2 && p.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
    let current = -1;
    return $.updateFor(node, (dt, self) => {
        if (!plan.length) return;
        const h = hourNow($, config.dayLength);
        let idx = plan.length - 1;
        for (let i = 0; i < plan.length; i++) if (plan[i][0] <= h) idx = i;
        if (idx !== current) { current = idx; self.emit('schedule', { hour: plan[idx][0] }); }
        const [x, y] = plan[idx][1], p = self.pos();
        if (Math.hypot(x - p.x, y - p.y) > 4) self.moveTowards({ x, y }, config.speed);
    });
}
