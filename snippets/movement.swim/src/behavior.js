// Плавание: в воде гасим скорость (drag), толкаем вверх (buoyancy), ввод — гребок.
export default function swim(node, config, $) {
    let inside = false;
    return $.updateFor(node, (dt, self) => {
        const now = $(config.water).some((i, w) => self.overlaps(w));
        if (now !== inside) { inside = now; self.emit(now ? 'water:enter' : 'water:leave', {}); }
        if (!inside) return;
        const v = self.velocity(), k = Math.max(0, 1 - config.drag * dt), d = $.input.vec('wasd');
        self.velocity(v.x * k + d.x * config.speed * dt * 4, v.y * k - config.buoyancy * dt + d.y * config.speed * dt * 4);
    });
}
