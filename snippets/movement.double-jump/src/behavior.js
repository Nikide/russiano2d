// Двойной прыжок: прыжок с земли делает movement.platformer, здесь — только воздушные.
export default function doubleJump(node, config, $) {
    let left = config.extraJumps;
    return $.updateFor(node, (dt, self) => {
        if (self.onFloor()) { left = config.extraJumps; return; }
        if (left > 0 && $.input.pressed(config.jumpKey)) {
            left--;
            self.jump(config.jumpForce);
        }
    });
}
