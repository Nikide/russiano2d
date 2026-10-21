// Удержание: прогресс 0..1 в data('progress'); события hold:start/cancel и итоговое $.emit.
export default function holdAction(node, config, $) {
    let t = 0;
    return $.updateFor(node, (dt, self) => {
        const who = $(config.actor);
        const ok = who.length && self.distanceTo(who) <= config.radius && $.input.down(config.key);
        if (!ok) { if (t > 0) { t = 0; self.data('progress', 0).emit('hold:cancel', {}); } return; }
        if (t === 0) self.emit('hold:start', {});
        t += dt * 1000;
        self.data('progress', Math.min(1, t / config.time));
        if (t >= config.time) { t = 0; self.data('progress', 0); $.emit(config.event, { target: self, by: who }); }
    });
}
