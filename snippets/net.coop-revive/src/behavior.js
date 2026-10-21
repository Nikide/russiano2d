// Поднятие: rpc revive { target } от пира; хост проверяет и меняет hp.
export default function coopRevive(node, config, $) {
    const handle = (data, peerId) => {
        const by = $('#player:' + peerId), t = $('#' + (data && data.target));
        if (!by.length || !t.length || !by.alive() || t.alive() || by.distanceTo(t) > config.radius) return;
        t.hp(config.hp);
        $.net.broadcast('revived', { target: data.target, by: peerId }, { delivery: 'reliable' });
        $.emit('revived', { target: data.target });
    };
    $.net.handle('revive', handle);
    const ask = (e) => { if ($.net.online() && !$.net.isAuthority()) $.net.rpc('revive', e.data || {}); };
    $.on('net:revive', ask);
    return () => { $.net.unhandle('revive'); $.off('net:revive', ask); };
}
