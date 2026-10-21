// Проверка на хосте: игрок пира рядом с целью → событие действия на хосте и рассылка.
export default function serverAction(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const handle = (data, peerId) => {
        const who = $('#player:' + peerId), t = config.target ? sel(config.target) : node;
        if (!who.length || !t.length || who.distanceTo(t) > config.maxDistance) { $.net.send(config.name + ':denied', {}, { peer: peerId }); return; }
        $.emit(config.name, { by: peerId, data });
        $.net.broadcast(config.name + ':done', { by: peerId }, { delivery: 'reliable' });
    };
    $.net.handle(config.name, handle);
    const call = () => $.net.rpc(config.name, { id: node.attr('id') });
    $.on(config.name + ':request', call);
    return () => { $.net.unhandle(config.name); $.off(config.name + ':request', call); };
}
