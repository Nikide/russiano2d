// Щит: фильтр урона поглощает из запаса; после паузы без урона — восстановление.
export default function shield(node, config, $) {
    let value = config.capacity, quiet = 0;
    node.data('shield', value);
    const off = node.damageFilter((info) => {
        quiet = 0;
        const absorbed = Math.min(value, info.amount);
        value -= absorbed;
        node.data('shield', value);
        if (absorbed > 0) node.emit('shield:hit', { absorbed, left: value });
        if (value <= 0 && absorbed > 0) node.emit('shield:broken', {});
        return info.amount - absorbed;
    });
    const stop = $.updateFor(node, (dt, self) => {
        quiet += dt * 1000;
        if (quiet < config.delay || value >= config.capacity) return;
        value = Math.min(config.capacity, value + config.regen * dt);
        self.data('shield', value);
    });
    return () => { off(); stop(); };
}
