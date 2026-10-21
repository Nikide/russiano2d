// Пакет игрока: ближайший подходящий объект в радиусе получает 'interact' { by }.
export default function pressAction(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (!$.input.pressed(config.key)) return;
        let best = null;
        $(config.targets).each((i, t) => { const d = self.distanceTo(t); if (d <= config.radius && (!best || d < best.d)) best = { t, d }; });
        if (best) best.t.emit('interact', { by: self });
    });
}
