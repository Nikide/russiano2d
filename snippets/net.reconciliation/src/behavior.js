// Подтверждение: хост шлёт ack { seq, state }; клиент — $.net.acknowledge.
export default function reconciliation(node, config, $) {
    const onInput = (input, peerId) => {
        const w = $('#player:' + peerId);
        if (!w.length || !input) return;
        const p = w.pos();
        $.net.send('ack', { seq: input.seq, state: { x: p.x, y: p.y } }, { peer: peerId, delivery: 'input' });
    };
    const onAck = (data) => { if (data && !$.net.isAuthority()) $.net.acknowledge(data.state, data.seq); };
    $.net.on('input', onInput);
    $.net.on('ack', onAck);
    return () => { $.net.off('input', onInput); $.net.off('ack', onAck); };
}
