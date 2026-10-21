// Фокус: death → panTo + zoomTo; замедление времени на hold.
export default function deathFocus(node, config, $) {
    const on = () => {
        const p = node.pos();
        $.camera.unfollow();
        $.camera.panTo(p.x, p.y, 300);
        $.camera.zoomTo(config.zoom, 300);
        if (config.slowmo) $.time.scale(0.3);
        $.time.wait(config.hold).then(() => { $.time.scale(1); $.camera.zoomTo(1, 300); $.emit('death-focus:end', {}); });
    };
    node.on('death', on);
    return () => node.off('death', on);
}
