// Ресурс в data(resource); общий для всех способностей с тем же именем ресурса.
export default function resourceCost(node, config, $) {
    if (node.data(config.resource) === undefined) node.data(config.resource, config.max);
    const tryIt = (e) => { if (e.data.id === config.id && e.data.ok && (node.data(config.resource) || 0) < config.cost) { e.data.ok = false; e.data.reason = config.resource; } };
    const cast = (e) => { if (e.data.id === config.id) node.data(config.resource, (node.data(config.resource) || 0) - config.cost); };
    node.on('ability:try', tryIt);
    node.on('ability:cast', cast);
    const stop = $.updateFor(node, (dt, self) => {
        const v = self.data(config.resource) || 0;
        if (v < config.max) self.data(config.resource, Math.min(config.max, v + config.regen * dt));
    });
    return () => { stop(); node.off('ability:try', tryIt); node.off('ability:cast', cast); };
}
