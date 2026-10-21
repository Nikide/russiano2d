// Вход: код комнаты = её id; результат — room:joined / room:join-failed.
export default function roomJoin(node, config, $) {
    const join = (e) => { const d = e.data || {}; if (!d.code) return; $.net.room.join(d.address || '127.0.0.1', d.port || config.port, d.code, { id: d.code }); };
    const ok = (room) => $.emit('room:entered', { room });
    const full = () => $.emit('room:join-failed', { reason: 'full' });
    $.on('room:join-code', join);
    $.net.on('room:joined', ok);
    $.net.on('room:full', full);
    return () => { $.off('room:join-code', join); $.net.off('room:joined', ok); $.net.off('room:full', full); };
}
