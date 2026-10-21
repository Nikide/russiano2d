// Готовность: клиент — net ready; хост считает и рассылает старт.
export default function readyCheck(node, config, $) {
    const ready = new Set();
    const mark = (data, peerId) => { if (data && data.ready) ready.add(peerId); else ready.delete(peerId); $.emit('ready:changed', { ready: ready.size }); };
    const tryStart = () => {
        if (!$.net.isAuthority()) { $.net.send('ready', { ready: true }); return; }
        const n = $.net.playerCount();
        if (n < config.minPlayers || ready.size < n - 1) { $.emit('ready:blocked', { ready: ready.size, players: n }); return; }
        $.net.broadcast(config.startEvent, {}, { delivery: 'reliable' });
        $.emit(config.startEvent, {});
    };
    const disconnected = (peer) => { ready.delete(peer && peer.id); $.emit('ready:changed', { ready: ready.size }); };
    const relay = () => $.emit(config.startEvent, {});
    $.net.on('ready', mark);
    $.net.on('disconnect', disconnected);
    $.net.on(config.startEvent, relay);
    $.on('ready:toggle', tryStart);
    return () => { $.net.off('ready', mark); $.net.off('disconnect', disconnected); $.net.off(config.startEvent, relay); $.off('ready:toggle', tryStart); };
}
