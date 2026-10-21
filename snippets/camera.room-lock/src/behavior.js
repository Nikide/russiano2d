// Комната: center — камера в центре узла; clamp — границы узла.
export default function cameraRoomLock(node, config, $) {
    let inside = false;
    const stop = $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        const c = self.pos(), w = self.width(), h = self.height();
        if (!inside) { $.camera.limits(null); $.camera.follow(config.player); return; }
        if (config.mode === 'center') { $.camera.unfollow(); $.camera.panTo(c.x, c.y, 300); }
        else $.camera.limits(c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2);
        $.emit('room:camera', { room: self.attr('id') });
    });
    return () => { stop(); if (inside) { $.camera.limits(null); $.camera.follow(config.player); } };
}
