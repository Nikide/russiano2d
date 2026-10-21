// Телепорт: пересечение → актор в позицию метки; общий кулдаун в data актора.
export default function teleporter(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.actor), to = sel(config.target);
        if (!who.length || !to.length || !self.overlaps(who)) return;
        const now = $.time.now();
        if (now < (who.data('teleportReady') || 0)) return;
        const q = to.pos();
        who.at(q.x, q.y).velocity(0, 0).data('teleportReady', now + config.cooldown);
        self.emit('teleport', { to: config.target });
    });
}
