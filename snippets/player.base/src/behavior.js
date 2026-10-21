// Игрок: встроенный контроллер узла .controls() + .speed(); камера — $.camera.follow.
export default function playerBase(node, config, $) {
    node.addClass('player').speed(config.speed).controls(config.scheme);
    if (config.camera) $.camera.follow(node);
    return () => { node.removeClass('player'); if (config.camera) $.camera.unfollow(); };
}
