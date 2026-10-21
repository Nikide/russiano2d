
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function speedScale(node, config, $) {
    const c = clip(config.clip);
    let lastK = -1;
    return $.updateFor(node, (dt, self) => {
        if (!c) return;
        const v = self.velocity(), k = Math.max(config.min, Math.min(config.max, Math.hypot(v.x, v.y) / config.refSpeed));
        if (Math.abs(k - lastK) < 0.05) return;
        lastK = k;
        self.animate({ from: c.from, to: c.to, speed: c.speed * k, loop: true });
    });
}
