// Границы камеры уровня: $.camera.limits; при снятии — без границ.
export default function cameraBounds(node, config, $) {
    $.camera.limits(config.min[0], config.min[1], config.max[0], config.max[1]);
    return () => $.camera.limits(null);
}
