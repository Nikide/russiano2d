
// Лобби: список игроков { id, name, ready } — общий через broadcast хоста.

export default function lobby(node, config, $) {
    const players = {};
    const publish = () => { $.store.set('lobby', Object.values(players)); $.emit('lobby', { players: Object.values(players) }); if ($.net.isAuthority()) $.net.broadcast('lobby:list', Object.values(players), { delivery: 'reliable' }); };
    const hello = (data, peerId) => { players[peerId] = { id: peerId, name: data && data.name || 'Игрок', ready: false }; publish(); };
    const list = (data) => { for (const k of Object.keys(players)) delete players[k]; for (const p of data || []) players[p.id] = p; publish(); };
    const bye = (peer) => { delete players[peer && peer.id]; publish(); };
    const onConnect = () => { if (!$.net.isAuthority()) $.net.send('lobby:hello', { name: config.name }); };
    $.net.on('lobby:hello', hello); $.net.on('lobby:list', list); $.net.on('disconnect', bye); $.net.on('connect', onConnect);
    return () => { $.net.off('lobby:hello', hello); $.net.off('lobby:list', list); $.net.off('disconnect', bye); $.net.off('connect', onConnect); };
}
