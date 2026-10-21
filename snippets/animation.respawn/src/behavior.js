// Эффект возрождения: событие respawn → мигание alpha и частицы пресета.
export default function animRespawn(node, config, $) {
    let left = 0;
    const on = () => {
        left = config.blinkMs;
        const p = node.pos();
        if (config.particles) { const part = $('<particles>', $.particles.preset(config.particles, { amount: 20 })).at(p.x, p.y).appendTo($.world); $.time.wait(1000).then(() => part.remove()); }
    };
    node.on('respawn', on);
    const stop = $.updateFor(node, (dt, self) => { if (left <= 0) return; left -= dt * 1000; self.alpha(left > 0 && Math.floor(left / 90) % 2 ? 0.3 : 1); });
    return () => { stop(); node.off('respawn', on); };
}
