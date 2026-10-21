// Сутки: час из $.time.now; цвет фона мира — смешение день/ночь.
function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export default function dayNight(node, config, $) {
    let night = null;
    return $.updateFor(node, () => {
        const h = (($.time.now() / 1000) % config.dayLength) / config.dayLength * 24;
        const k = (Math.cos(h / 24 * Math.PI * 2) + 1) / 2;
        $.world.color(mix(config.dayColor, config.nightColor, k));
        $.store.set('hour', h);
        const isNight = h < 6 || h >= 20;
        if (isNight !== night) { night = isNight; $.emit(isNight ? 'night' : 'day', { hour: h }); }
    });
}
