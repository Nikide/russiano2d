// Телепорт: пересечение → актор в позицию метки; общий кулдаун в data актора.
export default function teleporter(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const who = $(config.actor), to = $(config.target);
        if (!who.length || !to.length || !self.overlaps(who)) return;
        const now = $.time.now();
        if (now < (who.data('teleportReady') || 0)) return;
        const q = to.pos();
        who.at(q.x, q.y).velocity(0, 0).data('teleportReady', now + config.cooldown);
        self.emit('teleport', { to: config.target });
    });
}
