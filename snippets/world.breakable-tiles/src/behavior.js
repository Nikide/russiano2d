// Разрушение: событие explosion → клетки в радиусе с номером из списка обнуляются (.setTile).
export default function breakableTiles(node, config, $) {
    const types = new Set(config.breakable.map(Number));
    const broken = [];
    const boom = (e) => {
        const raw = node.data('tilemapNode');
        if (!raw || raw.removed) return;
        const tm = $(raw), d = e.data || {}, p = tm.pos(), ox = p.x - tm.width() / 2, oy = p.y - tm.height() / 2, T = config.tile, r = d.radius || T;
        for (let y = Math.floor((d.y - r - oy) / T); y <= Math.floor((d.y + r - oy) / T); y++)
            for (let x = Math.floor((d.x - r - ox) / T); x <= Math.floor((d.x + r - ox) / T); x++) {
                const t = tm.tileAt(x, y);
                if (!types.has(t)) continue;
                tm.setTile(x, y, 0);
                broken.push({ x, y, t, left: config.restore });
                node.emit('tile:broken', { x, y });
            }
    };
    $.on('explosion', boom);
    const stop = $.updateFor(node, (dt) => {
        if (!config.restore) return;
        const raw = node.data('tilemapNode');
        if (!raw || raw.removed) return;
        for (let i = broken.length - 1; i >= 0; i--) { broken[i].left -= dt * 1000; if (broken[i].left <= 0) { $(raw).setTile(broken[i].x, broken[i].y, broken[i].t); broken.splice(i, 1); } }
    });
    return () => { stop(); $.off('explosion', boom); };
}
