// Движение платформера: обычная функция поведения (docs/SNIPPETS.md).
export default function platformer(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const v = $.input.vec(config.keys);
        self.velocity(v.x * config.speed, self.velocity().y);
        if ($.input.pressed(config.jumpKey) && self.onFloor()) self.jump(config.jumpForce);
    });
}
