
// Сеть: только высокоуровневый $.net; соединения открывает игра (события net:host / net:join).
const online = ($) => !!$.net.online();

export default function clientSession(node, config, $) {
    let wait = -1;
    const join = (e) => { const d = e.data || {}; $.net.join(d.address || config.address, d.port || config.port); wait = config.timeout; };
    const ok = () => { wait = -1; $.emit('net:joined', {}); };
    const fail = (err) => { wait = -1; $.emit('net:join-failed', { reason: String(err && err.message || err || 'error') }); };
    $.net.on('connect', ok);
    $.net.on('error', fail);
    $.on('net:join', join);
    const stop = $.updateFor(node, (dt) => { if (wait < 0) return; wait -= dt * 1000; if (wait <= 0) { $.net.leave(); fail('timeout'); } });
    return () => { stop(); $.net.off('connect', ok); $.net.off('error', fail); $.off('net:join', join); };
}
