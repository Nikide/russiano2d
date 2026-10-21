// Команды: player:<peer> получает класс team-<имя> и .team(n).
export default function teamAssignment(node, config, $) {
    let i = 0;
    const assign = (peer) => {
        if (!$.net.isAuthority()) return;
        const team = config.teams[i % config.teams.length], role = config.roles.length ? config.roles[i % config.roles.length] : '';
        i++;
        $.net.broadcast('team', { id: 'player:' + peer.id, team, role }, { delivery: 'reliable' });
        apply({ id: 'player:' + peer.id, team, role });
    };
    const apply = (d) => { const w = $('#' + d.id); if (!w.length) return; w.addClass('team-' + d.team).team(config.teams.indexOf(d.team) + 1).data('role', d.role); $.emit('team:assigned', d); };
    $.net.on('connect', assign);
    $.net.on('team', apply);
    return () => { $.net.off('connect', assign); $.net.off('team', apply); };
}
