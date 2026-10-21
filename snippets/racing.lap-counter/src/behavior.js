// Круги: следующие ворота по data('order'); финиш — race:finish { time, best }.
export default function lapCounter(node, config, $) {
    let next = 0, lap = 0, lapStart = $.time.now(), start = lapStart, best = null, done = false;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        const gates = $(config.gates).nodes.slice().sort((a, b) => (Number($(a).data('order')) || 0) - (Number($(b).data('order')) || 0));
        if (!gates.length || !self.overlaps($(gates[next]))) return;
        next++;
        self.data('gate', next);
        if (next < gates.length) return;
        next = 0; lap++;
        const now = $.time.now(), t = now - lapStart;
        lapStart = now;
        best = best === null ? t : Math.min(best, t);
        self.data('lap', lap).data('bestLap', best).emit('race:lap', { lap, time: t, best });
        if (lap >= config.laps) { done = true; $.emit('race:finish', { id: self.attr('id'), time: now - start, best }); }
    });
}
