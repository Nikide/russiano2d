// Преследование: moveTowards в радиусе.
export default function chase(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if ($(config.target).length && self.distanceTo(config.target) < config.radius) self.moveTowards(config.target, config.speed);
    });
}
