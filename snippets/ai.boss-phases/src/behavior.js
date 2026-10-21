// Фазы: доля hp/maxHp пересекает порог → phase N (1 — начальная).
export default function bossPhases(node, config, $) {
    const th = config.thresholds.map(Number).filter(Number.isFinite).sort((a, b) => b - a);
    let phase = 1, max = 0;
    node.addClass('phase-1');
    return $.updateFor(node, (dt, self) => {
        const hp = self.hp();
        if (hp > max) max = hp;
        if (!max) return;
        const pct = hp / max * 100;
        let want = 1;
        for (const t of th) if (pct <= t) want++;
        if (want === phase) return;
        self.removeClass('phase-' + phase).addClass('phase-' + want);
        phase = want;
        self.data('phase', phase);
        self.emit('phase', { phase, percent: pct });
    });
}
