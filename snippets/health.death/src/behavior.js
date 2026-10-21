// Смерть: .controls(false), визуал, $.emit, опциональное удаление.
export default function death(node, config, $) {
    let dead = false, left = 0;
    return $.updateFor(node, (dt, self) => {
        if (!dead) {
            if (self.alive()) return;
            dead = true;
            self.controls(false);
            self.velocity(0, 0);
            if (config.visual === 'fade') self.fadeOut(400);
            else if (config.visual === 'flash') self.flash('#ffffff', 200);
            if (config.event) $.emit(config.event, { node: self });
            left = config.removeAfter;
            return;
        }
        if (self.alive()) { dead = false; self.alpha(1); return; }    // respawn
        if (config.removeAfter > 0) { left -= dt * 1000; if (left <= 0) self.remove(); }
    });
}
