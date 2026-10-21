// Потребности 0..100: меньшая — цель; у точки восполняется.
export default function dailyNeeds(node, config, $) {
    const spots = config.needs.map((s) => s.split('=')).map(([n, xy]) => [n.trim(), (xy || '').split(',').map(Number)])
        .filter(([n, p]) => n && p.length === 2 && p.every(Number.isFinite));
    const level = Object.fromEntries(spots.map(([n], i) => [n, 100 - i * 20]));
    return $.updateFor(node, (dt, self) => {
        if (!spots.length) return;
        let goal = spots[0];
        for (const s of spots) if (level[s[0]] < level[goal[0]]) goal = s;
        const p = self.pos(), [x, y] = goal[1];
        const at = Math.hypot(x - p.x, y - p.y) <= 6;
        for (const [n] of spots) level[n] = Math.max(0, Math.min(100, level[n] + (n === goal[0] && at ? config.refill : -config.decay) * dt));
        if (!at) self.moveTowards({ x, y }, config.speed);
        self.data('needs', { ...level }).data('need', goal[0]);
    });
}
