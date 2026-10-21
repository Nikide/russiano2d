// Голос: событие vote { map } (клиент → rpc), итог — vote:result и загрузка сцены.
export default function voteMap(node, config, $) {
    const votes = {};
    let t = -1;
    const start = () => { for (const k of Object.keys(votes)) delete votes[k]; t = config.time; $.emit('vote:start', { maps: config.maps }); };
    const cast = (data, peerId) => { if (t >= 0 && data && config.maps.includes(data.map)) votes[peerId ?? 'local'] = data.map; };
    const ask = (e) => { if ($.net.online() && !$.net.isAuthority()) $.net.rpc('vote', e.data); else cast(e.data, 'local'); };
    $.net.handle('vote', cast);
    $.on('vote', ask);
    $.on('round:end', start);
    const stop = $.updateFor(node, (dt) => {
        if (t < 0) return;
        t -= dt * 1000;
        if (t > 0) return;
        t = -1;
        const count = {};
        for (const m of Object.values(votes)) count[m] = (count[m] || 0) + 1;
        const best = config.maps.reduce((a, m) => ((count[m] || 0) > (count[a] || 0) ? m : a), config.maps[0]);
        $.emit('vote:result', { map: best, votes: count });
        if ($.net.online() && $.net.isAuthority()) $.net.broadcast('vote:result', { map: best }, { delivery: 'reliable' });
    });
    return () => { stop(); $.net.unhandle('vote'); $.off('vote', ask); $.off('round:end', start); };
}
