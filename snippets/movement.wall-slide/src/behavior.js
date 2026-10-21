// Скольжение: прижат к стене, не на земле, падает — vy не больше maxFall.
export default function wallSlide(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (self.onFloor() || !self.onWall()) return;
        const v = self.velocity();
        if (v.y > config.maxFall) self.velocity(v.x, config.maxFall);
    });
}
