// Езда: платформа под ногами — сдвигаем узел на её смещение за кадр.
export default function platformRide(node, config, $) {
    let ride = null, last = null;
    return $.updateFor(node, (dt, self) => {
        const p = self.pos(), feet = p.y + self.height() / 2 + 2;
        let under = null;
        if (self.onFloor()) $(config.platforms).each((i, pl) => { const b = pl.pos(); if (Math.abs(b.y - pl.height() / 2 - feet) < 6 && Math.abs(b.x - p.x) < pl.width() / 2 + self.width() / 2) under = pl; });
        const raw = under ? under.get(0) : null;
        if (raw !== ride) { ride = raw; last = under ? under.pos() : null; return; }
        if (!under) return;
        const now = under.pos();
        self.at(p.x + now.x - last.x, p.y + now.y - last.y);
        last = now;
    });
}
