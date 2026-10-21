
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

const DIRS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
export default function direction8(node, config, $) {
    const map = Object.fromEntries(config.clips.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    return $.updateFor(node, (dt, self) => {
        const v = self.velocity();
        if (Math.hypot(v.x, v.y) < config.threshold) return;
        const k = DIRS[(Math.round(Math.atan2(v.y, v.x) / (Math.PI / 4)) + 8) % 8];
        if (map[k]) play(self, k, map[k]);
    });
}
