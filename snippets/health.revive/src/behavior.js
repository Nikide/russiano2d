// Поднятие: hp 0 → прогресс, пока reviver рядом и держит клавишу.
export default function revive(node, config, $) {
    let progress = 0;
    return $.updateFor(node, (dt, self) => {
        if (self.alive()) { progress = 0; return; }
        const r = $(config.reviver);
        const ok = r.length && r.alive() && self.distanceTo(r) <= config.radius && $.input.down(config.key);
        if (!ok) { if (progress > 0) { progress = 0; self.emit('revive:cancel', {}); } return; }
        if (progress === 0) self.emit('revive:start', {});
        progress += dt * 1000;
        self.data('reviveProgress', Math.min(1, progress / config.time));
        if (progress >= config.time) { progress = 0; self.hp(config.hp); self.emit('revive:done', { by: r }); }
    });
}
