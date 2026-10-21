// Зона свободы — встроенная настройка камеры.
export default function cameraDeadzone(node, config, $) {
    $.camera.deadzone(config.size[0], config.size[1]);
    return () => $.camera.deadzone(false);
}
