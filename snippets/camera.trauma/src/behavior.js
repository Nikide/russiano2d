// Травма 0..1; событие damaged наблюдаемого и глобальное camera:trauma { amount }.
export default function cameraTrauma(node, config, $) {
    let trauma = 0;
    const add = (v) => { trauma = Math.min(1, trauma + v); };
    const onHit = (e) => add((e.data.amount || 0) * config.perHit);
    const onTrauma = (e) => add(Number(e.data && e.data.amount) || 0.3);
    const w = $(config.watch);
    if (w.length) w.on('damaged', onHit);
    $.on('camera:trauma', onTrauma);
    const stop = $.updateFor(node, (dt) => {
        if (trauma <= 0) return;
        if (!$.store.get('reduceMotion', false)) $.camera.shake(config.max * trauma * trauma, Math.max(16, dt * 1000 * 2));
        trauma = Math.max(0, trauma - config.decay * dt);
    });
    return () => { stop(); $.off('camera:trauma', onTrauma); if (w.length) w.off('damaged', onHit); };
}
