
// Партия хранится у лидера: data('party') — массив id участников по порядку.
function partyOf(leader) { return (leader.data('party') || []).slice(); }

export default function partyMember(node, config, $) {
    const id = node.attr('id');
    const join = () => { const l = $(config.leader); if (!l.length || !id) return; const p = partyOf(l); if (!p.includes(id)) { p.splice(Math.min(config.order || p.length, p.length), 0, id); l.data('party', p); $.emit('party:changed', { party: p }); } };
    const leave = () => { const l = $(config.leader); if (!l.length) return; const p = partyOf(l).filter((x) => x !== id); l.data('party', p); $.emit('party:changed', { party: p }); };
    node.on('party:join', join);
    node.on('party:leave', leave);
    if (config.joinNow) join();
    return () => { node.off('party:join', join); node.off('party:leave', leave); leave(); };
}
