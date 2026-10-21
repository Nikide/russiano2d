// Следование: идёт к цели, пока дальше distance.
export default function followTarget(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (!$(config.target).length) return;
        if (self.distanceTo(config.target) > config.distance) self.moveTowards(config.target, config.speed);
    });
}
