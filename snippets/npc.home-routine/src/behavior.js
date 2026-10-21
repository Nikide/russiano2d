
// Игровые часы: час суток из игрового времени ($.time.now) и длины суток.
function hourNow($, dayLength) { return (($.time.now() / 1000) % dayLength) / dayLength * 24; }

export default function homeRoutine(node, config, $) {
    let place = '';
    return $.updateFor(node, (dt, self) => {
        const h = hourNow($, config.dayLength);
        const want = h >= config.workFrom && h < config.workTo ? 'work' : (h >= config.sleepFrom || h < config.workFrom ? 'home' : 'rest');
        if (want !== place) { place = want; self.data('routine', place); self.emit('routine', { place }); }
        const t = config[place], p = self.pos();
        if (Math.hypot(t[0] - p.x, t[1] - p.y) > 4) self.moveTowards({ x: t[0], y: t[1] }, config.speed);
    });
}
