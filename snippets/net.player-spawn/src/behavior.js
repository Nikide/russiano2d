// Спавн: id 'player:<peer>'; владение — client на хосте, remote у других.
export default function playerSpawn(node, config, $) {
    const make = (id, owner) => {
        if ($('#' + id).length) return $('#' + id);
        const w = config.prefab && $.prefab.has(config.prefab)
            ? $.prefab.instantiate(config.prefab, { id, x: config.spawn[0], y: config.spawn[1], parent: $.world })
            : $('<player>', { id }).at(config.spawn[0], config.spawn[1]).size(24, 24).appendTo($.world);
        w.net({ id, owner });
        $.emit('player:spawned', { id });
        return w;
    };
    const onConn = (peer) => { if ($.net.isAuthority()) { make('player:' + peer.id, 'client'); $.net.broadcast('player:spawn', { id: 'player:' + peer.id }, { delivery: 'reliable' }); } };
    const onSpawn = (data) => make(data.id, 'remote');
    const onDisc = (peer) => { const w = $('#player:' + (peer && peer.id)); if (w.length) { $.net.unreplicate(w); w.remove(); } };
    $.net.on('connect', onConn); $.net.on('player:spawn', onSpawn); $.net.on('disconnect', onDisc);
    return () => { $.net.off('connect', onConn); $.net.off('player:spawn', onSpawn); $.net.off('disconnect', onDisc); };
}
