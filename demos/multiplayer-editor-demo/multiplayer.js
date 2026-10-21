// Создано Russiano2D Editor из Project Settings. Подключите из main.js.
export const multiplayer = Object.freeze({ topology: "authoritative", port: 7777, maxPeers: 8, syncRate: 20 });

export function startHost() {
    const started = $.net.start({ topology: multiplayer.topology, authority: 'host', listen: multiplayer.port, maxPeers: multiplayer.maxPeers });
    if (started) $.net.syncRate(multiplayer.syncRate);
    return started;
}

export function joinHost(address = '127.0.0.1') {
    const joined = $.net.join(address, multiplayer.port, { topology: multiplayer.topology });
    if (joined) $.net.syncRate(multiplayer.syncRate);
    return joined;
}

export function syncEntity(selector, id, owner = 'host') {
    return $(selector).net({ id, owner, fields: ['x', 'y', 'angle', 'hp'], interpolation: owner !== 'local' });
}

export function sendInput(input) { return $.net.input(input); }
