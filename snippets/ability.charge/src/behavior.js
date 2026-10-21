// Заряды: data('charges:<id>'); каждый каст тратит один.
export default function abilityCharge(node, config, $) {
    let n = config.charges, t = 0;
    node.data('charges:' + config.id, n);
    const tryIt = (e) => { if (e.data.id === config.id && e.data.ok && n <= 0) { e.data.ok = false; e.data.reason = 'charges'; } };
    const cast = (e) => { if (e.data.id === config.id) { n--; node.data('charges:' + config.id, n); } };
    node.on('ability:try', tryIt);
    node.on('ability:cast', cast);
    const stop = $.updateFor(node, (dt, self) => {
        if (n >= config.charges) { t = 0; return; }
        t += dt * 1000;
        if (t >= config.recharge) { t = 0; n++; self.data('charges:' + config.id, n).emit('ability:charge', { id: config.id, charges: n }); }
    });
    return () => { stop(); node.off('ability:try', tryIt); node.off('ability:cast', cast); };
}
