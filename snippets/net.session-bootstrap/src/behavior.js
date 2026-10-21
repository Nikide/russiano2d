
// Сеть: только высокоуровневый $.net; соединения открывает игра (события net:host / net:join).
const online = ($) => !!$.net.online();

export default function sessionBootstrap(node, config, $) {
    $.net.topology(config.topology);
    $.net.syncRate(config.syncRate);
    const host = () => { $.net.host(config.port, { maxPeers: config.maxPeers }); $.emit('net:started', { role: 'host', port: config.port }); };
    const join = (e) => { const d = e.data || {}; $.net.join(d.address || '127.0.0.1', d.port || config.port); $.emit('net:started', { role: 'client' }); };
    $.on('net:host', host);
    $.on('net:join', join);
    return () => { $.off('net:host', host); $.off('net:join', join); };
}
