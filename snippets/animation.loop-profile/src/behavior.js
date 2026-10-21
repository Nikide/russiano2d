
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function loopProfile(node, config, $) {
    const c = clip(config.clip);
    if (!c) return () => {};
    if (config.mode !== 'ping-pong') { node.animate({ from: c.from, to: c.to, speed: c.speed, loop: config.mode === 'loop' }); return () => node.stopAnim(); }
    let f = c.from, dir = 1, t = 0;
    const stop = $.updateFor(node, (dt, self) => {
        t += dt * c.speed;
        while (t >= 1) { t -= 1; if (f + dir > c.to || f + dir < c.from) dir = -dir; f += dir; self.frame(f); }
    });
    return () => stop();
}
