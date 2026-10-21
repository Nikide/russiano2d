// Вспышка: учитывает reduceMotion из настроек доступности (сила вдвое меньше).
export default function renderFlash(node, config, $) {
    const go = () => $.vfx.flash(config.color, { ms: config.ms, alpha: config.alpha * ($.store.get('reduceMotion', false) ? 0.5 : 1) });
    $.on(config.event, go);
    return () => $.off(config.event, go);
}
