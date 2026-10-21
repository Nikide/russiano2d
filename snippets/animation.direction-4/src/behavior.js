
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function direction4(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const v = self.velocity();
        if (Math.hypot(v.x, v.y) < config.threshold) return;
        const dir = Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'right' : 'left') : (v.y > 0 ? 'down' : 'up');
        play(self, dir, config[dir]);
    });
}
