// Плита: число пересечений ≥ need → нажата.
export default function pressurePlate(node, config, $) {
    let down = false;
    return $.updateFor(node, (dt, self) => {
        let n = 0;
        $(config.who).each((i, w) => { if (self.overlaps(w)) n++; });
        const now = n >= config.need;
        if (now === down) return;
        down = now;
        self.data('pressed', down).emit(down ? 'press' : 'release', { count: n });
        const ev = down ? config.pressEvent : config.releaseEvent;
        if (ev) $.emit(ev, { plate: self.attr('id') });
    });
}
