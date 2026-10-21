
// Анимация кадров узла: «a-b@скорость» → .animate({ from, to, speed, loop }); повтор той же — без перезапуска.
function clip(text) { const m = /^\s*(\d+)\s*-\s*(\d+)\s*(?:@\s*([\d.]+))?\s*$/.exec(String(text || '')); return m ? { from: +m[1], to: +m[2], speed: m[3] ? +m[3] : 10 } : null; }
function play(node, key, spec, loop) {
    const c = clip(spec);
    if (!c || node.data('animKey') === key) return false;
    node.data('animKey', key).animate({ from: c.from, to: c.to, speed: c.speed, loop: loop !== false });
    return true;
}

export default function jumpFall(node, config, $) {
    let air = false, land = 0;
    return $.updateFor(node, (dt, self) => {
        const floor = self.onFloor(), v = self.velocity();
        if (!floor) { air = true; self.data('animLock', true); play(self, v.y < 0 ? 'jump' : 'fall', v.y < 0 ? config.jump : config.fall); return; }
        if (air) { air = false; land = config.landMs; play(self, 'land', config.land, false); }
        if (land > 0) { land -= dt * 1000; if (land <= 0) self.data('animLock', false).data('animKey', ''); return; }
        if (self.data('animLock') && !land) self.data('animLock', false);
    });
}
