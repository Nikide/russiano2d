
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function animSpawn(node, config, $) {
    node.alpha(0).active(false).data('animLock', true);
    play(node, 'spawn', config.clip, false);
    node.fadeTo(1, config.ms).then(() => { node.active(true).data('animLock', false).data('animKey', ''); node.emit('spawned', {}); });
    return () => {};
}
