
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function animDeath(node, config, $) {
    let t = -1;
    const on = () => { t = config.duration; node.data('animLock', true).data('animKey', ''); play(node, 'death', config.clip, false); };
    node.on('death', on);
    const stop = $.updateFor(node, (dt, self) => { if (t < 0) return; t -= dt * 1000; if (t <= 0) { t = -1; self.emit('death:animated', {}); if (config.remove) self.remove(); } });
    return () => { stop(); node.off('death', on); };
}
