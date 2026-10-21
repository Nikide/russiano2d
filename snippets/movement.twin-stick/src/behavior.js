// Twin-stick: скорость от клавиш, взгляд — на мышь в мире.
export default function twinStick(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const v = $.input.vec(config.keys);
        self.velocity(v.x * config.speed, v.y * config.speed);
        const m = $.input.mouseWorld();
        if (m) { self.data('aim', m); if (config.rotate) self.lookAt(m); }
    });
}
