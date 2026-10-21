// Взгляд вперёд — встроенная настройка камеры.
export default function cameraLookahead(node, config, $) {
    $.camera.lookahead({ x: config.distance[0], y: config.distance[1] });
    return () => $.camera.lookahead(0);
}
