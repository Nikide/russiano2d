// Values mirror the Editor's runtime.multiplayer settings and generated
// multiplayer.js starter module.
export const multiplayer = Object.freeze({
    topology: 'authoritative',
    address: '127.0.0.1',
    port: 7777,
    maxPeers: 8,
    syncRate: 20,
    speed: 220,
    entityId: 'demo:shared-orb',
});

export function startHost() {
    const started = $.net.start({
        topology: multiplayer.topology,
        authority: 'host',
        listen: multiplayer.port,
        maxPeers: multiplayer.maxPeers,
    });
    if (started) $.net.syncRate(multiplayer.syncRate);
    return started;
}

export function joinHost(address = multiplayer.address) {
    const joined = $.net.join(address, multiplayer.port, {
        topology: multiplayer.topology,
    });
    if (joined) $.net.syncRate(multiplayer.syncRate);
    return joined;
}
