// Призыв: экземпляры живут lifetime; лимит одновременных.
export default function summon(node, config, $) {
    const live = [];
    const cast = (e) => {
        if (e.data.id !== config.id || !config.prefab || !$.prefab.has(config.prefab)) return;
        for (let i = live.length - 1; i >= 0; i--) if (live[i].removed) live.splice(i, 1);
        if (live.length >= config.max) { const old = live.shift(); $(old).remove(); }
        const t = e.data.target || node.pos();
        const w = $.prefab.instantiate(config.prefab, { x: t.x, y: t.y, parent: $.world });
        if (!w || !w.nodes) return;
        for (const n of w.nodes) {
            live.push(n);
            let left = config.lifetime;
            $.updateFor($(n), (dt, me) => { left -= dt * 1000; if (left <= 0) me.remove(); });
        }
        node.emit('summoned', { id: config.id, count: w.nodes.length });
    };
    node.on('ability:cast', cast);
    return () => node.off('ability:cast', cast);
}
