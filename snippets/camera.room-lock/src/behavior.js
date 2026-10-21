// Комната: center — камера в центре узла; clamp — границы узла.
export default function cameraRoomLock(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let inside = false;
    const stop = $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
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
