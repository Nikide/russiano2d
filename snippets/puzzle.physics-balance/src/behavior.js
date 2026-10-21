// Равновесие: |угол узла| ≤ tolerance непрерывно hold мс.
export default function physicsBalance(node, config, $) {
    let t = 0, done = false;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        const a = ((self.angle() % 360) + 540) % 360 - 180;
        if (Math.abs(a) > config.tolerance) { if (t) self.emit('balance:lost', {}); t = 0; return; }
        t += dt * 1000;
        self.data('balance', Math.min(1, t / config.hold));
        if (t >= config.hold) { done = true; $.emit(config.solvedEvent, { puzzle: self.attr('id') }); }
    });
}
