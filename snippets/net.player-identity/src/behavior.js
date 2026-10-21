// Идентичность: data('identity') + цвет; другим — сообщение identity.
export default function playerIdentity(node, config, $) {
    const me = { name: $.save.profile().get('name') || config.name, color: config.color };
    node.data('identity', me).color(me.color);
    const share = () => $.net.broadcast('identity', { id: node.attr('id'), ...me }, { delivery: 'reliable' });
    const apply = (data) => { const w = $('#' + (data && data.id)); if (w.length) w.data('identity', { name: data.name, color: data.color }).color(data.color); };
    $.net.on('connect', share);
    $.net.on('identity', apply);
    return () => { $.net.off('connect', share); $.net.off('identity', apply); };
}
