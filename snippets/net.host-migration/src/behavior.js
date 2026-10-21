
// Сеть: только высокоуровневый $.net; соединения открывает игра (события net:host / net:join).
const online = ($) => !!$.net.online();

export default function hostMigration(node, config, $) {
    let known = [], pending = -1;
    const remember = () => { known = $.net.peers().map((p) => p.id).sort(); };
    const lost = (peer) => { if (!$.net.isAuthority() && peer && peer.host) pending = config.delay; };
    $.net.on('connect', remember);
    $.net.on('disconnect', lost);
    const stop = $.updateFor(node, (dt) => {
        if (pending < 0) return;
        pending -= dt * 1000;
        if (pending > 0) return;
        pending = -1;
        $.emit('host:migrating', {});
        // Без адресов peers в $.net (только id/RTT) новый хост объявляется событием; игра решает, кто поднимает host.
        $.emit('host:elect', { candidates: known });
    });
    return () => { stop(); $.net.off('connect', remember); $.net.off('disconnect', lost); };
}
