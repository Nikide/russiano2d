// Ожидание: flip по таймеру; цель в радиусе → data awake и событие wake.
export default function idle(node, config, $) {
    let t = 0, awake = false;
    return $.updateFor(node, (dt, self) => {
        if (awake) return;
        t += dt * 1000;
        if (config.look > 0 && t >= config.look) { t = 0; self.flip(!self.flip().x); }
        const tg = $(config.target);
        if (tg.length && self.distanceTo(tg) <= config.wake) { awake = true; self.data('awake', true); self.emit('wake', { target: tg }); }
    });
}
