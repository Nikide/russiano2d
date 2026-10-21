// Фильтр: room:info { id, mode, map, players, limit } → $.store rooms.
export default function matchmakingFilter(node, config, $) {
    const rooms = {};
    const publish = () => {
        const list = Object.values(rooms).filter((r) => (!config.mode || r.mode === config.mode) && (!config.map || r.map === config.map) && (!config.hideFull || r.players < r.limit));
        $.store.set('rooms', list);
        $.emit('rooms', { rooms: list });
    };
    const info = (data) => { if (data && data.id) { rooms[data.id] = data; publish(); } };
    $.net.on('room:info', info);
    return () => $.net.off('room:info', info);
}
