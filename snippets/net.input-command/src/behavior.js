// Ввод: клиент — $.net.input; хост — событие input применяет скорость к player:<peer>.
const KEYS = { left: 'a', right: 'd', up: 'w', down: 's', jump: 'space', fire: 'j' };
export default function inputCommand(node, config, $) {
    const onInput = (input, peerId) => {
        const w = $('#player:' + peerId);
        if (!w.length || !input) return;
        w.velocity(((input.right ? 1 : 0) - (input.left ? 1 : 0)) * config.speed, ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * config.speed);
        if (input.fire) w.emit('net:fire', {});
    };
    $.net.on('input', onInput);
    const stop = $.updateFor(node, () => {
        if (!$.net.online() || $.net.isAuthority()) return;
        const data = {};
        for (const a of config.actions) data[a] = $.input.down(KEYS[a] || a);
        $.net.input(data);
    });
    return () => { stop(); $.net.off('input', onInput); };
}
