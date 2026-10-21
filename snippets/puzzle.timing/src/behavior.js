// Тайминг: фаза 0..1; попадание — фаза в [0.5 − w/2, 0.5 + w/2].
export default function timing(node, config, $) {
    let t = 0, ok = 0, done = false;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        t = (t + dt * 1000) % config.period;
        const ph = t / config.period;
        self.data('phase', ph);
        if (!$.input.pressed(config.key)) return;
        if (Math.abs(ph - 0.5) <= config.window / 2) { ok++; self.emit('timing:hit', { count: ok }); if (ok >= config.hits) { done = true; $.emit(config.solvedEvent, { puzzle: self.attr('id') }); } }
        else { ok = 0; self.emit('timing:miss', {}); }
    });
}
