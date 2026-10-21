
// Сеть: только высокоуровневый $.net; соединения открывает игра (события net:host / net:join).
const online = ($) => !!$.net.online();

export default function hostSession(node, config, $) {
    const start = () => { if (online($)) return; $.net.host(config.port, { maxPeers: config.maxPeers }); };
    const onConn = (peer) => $.emit('player:connected', { peer: peer && peer.id });
    const onDisc = (peer) => $.emit('player:disconnected', { peer: peer && peer.id });
    $.net.on('connect', onConn);
    $.net.on('disconnect', onDisc);
    $.on('net:host', start);
    if (config.autostart) start();
    return () => { $.net.off('connect', onConn); $.net.off('disconnect', onDisc); $.off('net:host', start); };
}
