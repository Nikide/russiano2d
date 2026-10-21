// Лазание: пересечение с лестницей → без гравитации, скорость от ввода по y.
export default function climb(node, config, $) {
    let on = false;
    return $.updateFor(node, (dt, self) => {
        const now = $(config.ladder).some((i, l) => self.overlaps(l));
        if (now !== on) { on = now; self.gravity(!on); self.emit(on ? 'climb:start' : 'climb:end', {}); }
        if (!on) return;
        const v = $.input.vec('wasd');
        self.velocity(self.velocity().x, v.y * config.speed);
    });
}
