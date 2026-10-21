// Coyote: movement.platformer прыгает с земли, здесь — поздний прыжок в окне.
export default function coyoteJump(node, config, $) {
    let since = 1e9, used = false;
    return $.updateFor(node, (dt, self) => {
        if (self.onFloor()) { since = 0; used = false; return; }
        since += dt * 1000;
        if (!used && since <= config.window && $.input.pressed(config.jumpKey)) { used = true; self.jump(config.jumpForce); }
    });
}
