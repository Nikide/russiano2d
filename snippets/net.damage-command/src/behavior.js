// Урон: клиент — rpc damage { target, amount }; хост проверяет и применяет.
export default function damageCommand(node, config, $) {
    const handle = (data, peerId) => {
        const by = $('#player:' + peerId), t = $('#' + (data && data.target));
        if (!by.length || !t.length) return;
        if (by.distanceTo(t) > config.maxRange || !(data.amount > 0)) { $.net.send('damage:denied', {}, { peer: peerId }); return; }
        t.damage(Math.min(config.maxDamage, data.amount), by, data.type || 'net');
    };
    $.net.handle('damage', handle);
    const ask = (e) => { if (!$.net.isAuthority()) $.net.rpc('damage', e.data || {}); };
    $.on('net:damage', ask);
    return () => { $.net.unhandle('damage'); $.off('net:damage', ask); };
}
