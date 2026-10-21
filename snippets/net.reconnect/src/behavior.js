
// Сеть: только высокоуровневый $.net; соединения открывает игра (события net:host / net:join).
const online = ($) => !!$.net.online();

export default function reconnect(node, config, $) {
    let left = 0, wait = -1;
    const begin = () => { left = config.tries; wait = 0; };
    const ok = () => { left = 0; wait = -1; $.emit('net:reconnected', {}); };
    $.on('net:reconnect', begin);
    $.net.on('connect', ok);
    const stop = $.updateFor(node, (dt) => {
        if (wait < 0 || online($)) return;
        wait -= dt * 1000;
        if (wait > 0) return;
        if (left <= 0) { wait = -1; $.emit('net:reconnect-failed', {}); return; }
        left--; wait = config.gap;
        $.net.join(config.address, config.port);
    });
    return () => { stop(); $.off('net:reconnect', begin); $.net.off('connect', ok); };
}
