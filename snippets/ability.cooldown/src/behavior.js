// Перезарядка: отказ в ability:try; data('ready:<id>') 0..1.
export default function abilityCooldown(node, config, $) {
    let left = 0;
    const tryIt = (e) => { if (e.data.id === config.id && left > 0) { e.data.ok = false; e.data.reason = 'cooldown'; } };
    const cast = (e) => { if (e.data.id === config.id) left = config.cooldown; };
    node.on('ability:try', tryIt);
    node.on('ability:cast', cast);
    const stop = $.updateFor(node, (dt, self) => {
        if (left <= 0) return;
        left = Math.max(0, left - dt * 1000);
        self.data('ready:' + config.id, config.cooldown ? 1 - left / config.cooldown : 1);
        if (left === 0) self.emit('ability:ready', { id: config.id });
    });
    return () => { stop(); node.off('ability:try', tryIt); node.off('ability:cast', cast); };
}
