// Хуки: при переходе узла на кадр — событие на узле.
export default function eventHooks(node, config, $) {
    const map = {};
    for (const s of config.hooks) { const [f, ev] = s.split('='); if (ev && Number.isFinite(Number(f))) (map[Number(f)] || (map[Number(f)] = [])).push(ev.trim()); }
    let last = -1;
    return $.updateFor(node, (dt, self) => {
        const f = self.frame();
        if (f === last) return;
        last = f;
        for (const ev of map[f] || []) self.emit(ev, { frame: f });
    });
}
