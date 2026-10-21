// Снаряд: хост создаёт <bullet> с id 'shot:<n>' и owner host; урон тоже на хосте.
export default function projectileAuthority(node, config, $) {
    let n = 0;
    const spawn = (from, dir, by) => {
        const id = 'shot:' + (++n);
        const b = $('<bullet>', { id }).at(from.x, from.y).size(5, 5).appendTo($.world);
        b.net({ id, owner: 'host' });
        let life = config.lifetime;
        $.updateFor(b, (dt, me) => {
            const p = me.pos();
            me.at(p.x + dir.x * config.speed * dt, p.y + dir.y * config.speed * dt);
            life -= dt * 1000;
            const hit = $.world.query(p.x, p.y, 4).nodes.find((x) => x !== me.get(0) && x !== (by && by.get(0)) && $(x).hp() > 0);
            if (hit) { $(hit).damage(config.damage, by, 'ballistic'); life = 0; }
            if (life <= 0) { $.net.unreplicate(me); me.remove(); }
        });
    };
    const handle = (data, peerId) => { const by = $('#player:' + peerId); if (by.length && data && data.dir) spawn(by.pos(), data.dir, by); };
    $.net.handle('fire', handle);
    const onFire = () => { const dir = { x: node.flip().x ? -1 : 1, y: 0 }; if ($.net.isAuthority() || !$.net.online()) spawn(node.pos(), dir, node); else $.net.rpc('fire', { dir }); };
    node.on('net:fire', onFire);
    return () => { $.net.unhandle('fire'); node.off('net:fire', onFire); };
}
