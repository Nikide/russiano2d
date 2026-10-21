// Возрождение: hp упало до нуля → через delay .respawn(x, y).
export default function respawn(node, config, $) {
    let wait = -1;
    return $.updateFor(node, (dt, self) => {
        if (wait < 0) { if (!self.alive()) wait = config.delay; return; }
        wait -= dt * 1000;
        if (wait <= 0) { self.respawn(config.point[0], config.point[1]); wait = -1; self.emit('respawned', {}); }
    });
}
