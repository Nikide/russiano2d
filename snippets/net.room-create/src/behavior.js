// Комната: $.net.room.create; лимит — отключение лишних при join.
export default function roomCreate(node, config, $) {
    const rules = Object.fromEntries(config.rules.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    const create = () => { $.net.room.create(config.name, { id: config.name, rules, limit: config.limit }); $.emit('room:created', { name: config.name }); };
    const onJoin = (peerId) => { if ($.net.room.peers().length > config.limit) { $.net.send('room:full', {}, { peer: peerId }); $.net.disconnect(peerId); } };
    $.on('room:create', create);
    $.net.on('room:join', onJoin);
    return () => { $.off('room:create', create); $.net.off('room:join', onJoin); };
}
