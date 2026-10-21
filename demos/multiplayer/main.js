// High-level multiplayer example: one authoritative host owns the shared orb.
import { multiplayer, startHost, joinHost } from './multiplayer.js';

$.ready(($) => {
    const orb = $('<text>', {
        id: 'shared-orb', text: '●', size: 56, color: '#65e3ff',
    }).at(640, 360).appendTo($.world);
    const status = $('<text>', {
        id: 'net-status', text: 'H — host   J — join localhost', size: 22, color: '#ffffff',
    }).at(24, 36).appendTo($.world);

    // The same stable network id is registered on host and client. Host state
    // is sent automatically; clients interpolate remote transforms in the
    // runtime frame loop, with no transport polling in gameplay code.
    orb.net({ id: multiplayer.entityId, owner: 'host', fields: ['x', 'y', 'angle'] });

    $.net.on('connect', (peer) => status.text('Connected: ' + peer.id));
    $.net.on('disconnect', (peer) => status.text('Disconnected: ' + peer.id));
    $.net.on('error', (message) => status.text('Network error: ' + message));

    $.net.on('input', (input) => {
        if (!input || input.entity !== multiplayer.entityId) return;
        orb.at(orb.x + (Number(input.dx) || 0), orb.y + (Number(input.dy) || 0));
    });

    $.update((dt) => {
        if ($.input.pressed('h')) {
            const ok = startHost();
            status.text(ok ? 'Authoritative host on port ' + multiplayer.port : 'Could not start host');
        }
        if ($.input.pressed('j')) {
            const ok = joinHost(multiplayer.address);
            status.text(ok ? 'Connecting to ' + multiplayer.address + ':' + multiplayer.port : 'Could not connect');
        }

        const move = $.input.vec('wasd');
        if (!move.x && !move.y) return;
        const dx = move.x * multiplayer.speed * dt;
        const dy = move.y * multiplayer.speed * dt;
        if ($.net.authority() === 'host') {
            orb.at(orb.x + dx, orb.y + dy);
        } else if ($.net.online()) {
            $.net.input({ entity: multiplayer.entityId, dx, dy });
        }
    });
});
