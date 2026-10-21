// Погода: капли/снежинки — лёгкие узлы, перерождаются у верхнего края камеры.
export default function weather(node, config, $) {
    const drops = [];
    if (config.kind !== 'none') for (let i = 0; i < config.density; i++) drops.push($('<drop>', { class: 'weather' }).size(config.kind === 'rain' ? 1 : 3, config.kind === 'rain' ? 8 : 3).color('#c0d8ff').alpha(0.6).appendTo($.world));
    $.store.set('weather', { kind: config.kind, visibility: config.visibility });
    const fall = config.kind === 'rain' ? 600 : 60;
    const stop = $.updateFor(node, (dt) => {
        const v = $.camera.viewport();
        for (const d of drops) {
            const p = d.pos();
            let x = p.x + config.wind * dt, y = p.y + fall * dt;
            if (y > v.y + v.h || x < v.x - 20 || x > v.x + v.w + 20) { x = v.x + $.random.range(0, v.w); y = v.y - $.random.range(0, v.h * 0.3); }
            d.at(x, y);
        }
    });
    return () => { stop(); drops.forEach((d) => d.remove()); $.store.set('weather', { kind: 'none', visibility: 1 }); };
}
