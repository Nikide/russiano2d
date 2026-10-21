// Камера: одна настройка $.camera.follow, без покадровой логики.
export default function cameraFollow(node, config, $) {
    $.camera.follow(node, { smooth: config.smooth, deadzone: config.deadzone, lookahead: config.lookahead });
    return () => {};
}
