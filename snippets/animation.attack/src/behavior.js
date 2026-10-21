
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function animAttack(node, config, $) {
    let t = -1;
    const start = () => { t = 0; node.data('animLock', true).data('animKey', ''); play(node, 'attack', config.clip, false); };
    for (const ev of config.events) node.on(ev, start);
    const stop = $.updateFor(node, (dt, self) => {
        if (t < 0) return;
        const before = t;
        t += dt * 1000;
        if (before < config.activeFrom && t >= config.activeFrom) self.emit('attack:active', {});
        if (before < config.activeTo && t >= config.activeTo) self.emit('attack:recover', {});
        if (t >= config.duration) { t = -1; self.data('animLock', false).data('animKey', ''); self.emit('attack:end', {}); }
    });
    return () => { stop(); for (const ev of config.events) node.off(ev, start); };
}
