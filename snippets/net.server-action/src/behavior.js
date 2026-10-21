// Проверка на хосте: игрок пира рядом с целью → событие действия на хосте и рассылка.
export default function serverAction(node, config, $) {
    const handle = (data, peerId) => {
        const who = $('#player:' + peerId), t = config.target ? $(config.target) : node;
        if (!who.length || !t.length || who.distanceTo(t) > config.maxDistance) { $.net.send(config.name + ':denied', {}, { peer: peerId }); return; }
        $.emit(config.name, { by: peerId, data });
        $.net.broadcast(config.name + ':done', { by: peerId }, { delivery: 'reliable' });
    };
    $.net.handle(config.name, handle);
    const call = () => $.net.rpc(config.name, { id: node.attr('id') });
    $.on(config.name + ':request', call);
    return () => { $.net.unhandle(config.name); $.off(config.name + ':request', call); };
}
