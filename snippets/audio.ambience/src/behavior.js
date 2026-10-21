// Атмосфера: петля + случайные реплики окружения ($.random).
export default function ambience(node, config, $) {
    const bed = config.bed ? $.audio.play(config.bed, { loop: true, volume: config.volume, bus: 'ambience' }) : null;
    let t = config.every;
    const stop = $.updateFor(node, (dt) => {
        if (!config.randoms.length) return;
        t -= dt * 1000;
        if (t > 0) return;
        t = config.every * $.random.range(0.5, 1.5);
        $.audio.play($.random.pick(config.randoms), { volume: config.volume, bus: 'ambience' });
    });
    return () => { stop(); if (bed && bed.stop) bed.stop(); };
}
