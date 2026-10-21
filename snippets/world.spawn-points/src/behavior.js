// Свободная точка — первая без пересечений; события spawn:point или создание prefab.
export default function spawnPoints(node, config, $) {
    const on = () => {
        const free = $(config.points).nodes.find((n) => !$.world.query(n.x, n.y, config.clear).nodes.some((m) => m !== n && m.body >= 0));
        if (!free) { $.emit('spawn:busy', {}); return; }
        if (config.prefab && $.prefab.has(config.prefab)) $.prefab.instantiate(config.prefab, { x: free.x, y: free.y, parent: $.world });
        $.emit('spawn:point', { x: free.x, y: free.y, id: $(free).attr('id') });
    };
    $.on('spawn:request', on);
    return () => $.off('spawn:request', on);
}
