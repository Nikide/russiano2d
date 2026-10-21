// Раунд: состояния wait / play / end по таймеру хоста.
export default function roundState(node, config, $) {
    let state = 'wait', t = config.warmup;
    const set = (s) => { state = s; $.store.set('round', s); $.emit('round:' + s, {}); if ($.net.online() && $.net.isAuthority()) $.net.broadcast('round', { state: s }, { delivery: 'reliable' }); };
    const sync = (data) => { if (!$.net.isAuthority() && data) { state = data.state; $.store.set('round', state); $.emit('round:' + state, {}); } };
    $.net.on('round', sync);
    set('wait');
    const stop = $.updateFor(node, (dt) => {
        if ($.net.online() && !$.net.isAuthority()) return;
        t -= dt * 1000;
        if (t > 0) return;
        if (state === 'wait') { set('play'); t = config.length; } else if (state === 'play') { set('end'); t = config.after; } else { set('wait'); t = config.warmup; }
    });
    return () => { stop(); $.net.off('round', sync); };
}
