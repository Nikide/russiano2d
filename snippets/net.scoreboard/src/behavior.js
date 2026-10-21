// Счёт: только хост меняет; таблица — $.store scoreboard.
export default function scoreboard(node, config, $) {
    const score = {};
    const publish = () => { $.store.set('scoreboard', { ...score }); $.emit('scoreboard', { score: { ...score } }); };
    const add = (e) => { if ($.net.online() && !$.net.isAuthority()) return; const d = e.data || {}; score[d.id] = (score[d.id] || 0) + (Number(d.points) || 0); publish(); if ($.net.online()) $.net.broadcast('scoreboard', score, { delivery: 'reliable' }); };
    const sync = (data) => { for (const k of Object.keys(score)) delete score[k]; Object.assign(score, data || {}); publish(); };
    $.on('score', add);
    $.net.on('scoreboard', sync);
    return () => { $.off('score', add); $.net.off('scoreboard', sync); };
}
