// Буфер: запоминает нажатие в воздухе и прыгает в первый кадр на земле.
export default function jumpBuffer(node, config, $) {
    let left = 0;
    return $.updateFor(node, (dt, self) => {
        if (!self.onFloor()) { if ($.input.pressed(config.jumpKey)) left = config.buffer; else if (left > 0) left -= dt * 1000; return; }
        if (left > 0) { left = 0; self.jump(config.jumpForce); }
    });
}
