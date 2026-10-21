// Top-down: вектор ввода → скорость узла.
export default function topdown(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const v = $.input.vec(config.keys);
        self.velocity(v.x * config.speed, v.y * config.speed);
    });
}
