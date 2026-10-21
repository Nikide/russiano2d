// Границы: прямоугольник узла → $.camera.limits; выход — без границ.
export default function cameraBoundary(node, config, $) {
    let inside = false;
    const stop = $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        if (!inside) { $.camera.limits(null); return; }
        const c = self.pos(), w = self.width(), h = self.height();
        $.camera.limits(c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2);
    });
    return () => { stop(); if (inside) $.camera.limits(null); };
}
