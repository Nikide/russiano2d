// Взгляд: panTo на этот объект, пауза, follow игрока.
export default function lookAtTarget(node, config, $) {
    const go = () => {
        const p = node.pos();
        $.camera.unfollow();
        $.camera.panTo(p.x, p.y, config.ms);
        $.time.wait(config.ms + config.hold).then(() => $.camera.follow(config.player));
    };
    $.on(config.event, go);
    return () => $.off(config.event, go);
}
