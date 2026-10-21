// Пятнашки: клетка плитки — от origin; пустая — та, где плитки нет.
export default function slidingTiles(node, config, $) {
    const C = config.cell, [ox, oy] = config.origin;
    const cellOf = (n) => ({ c: Math.round((n.x - ox - C / 2) / C), r: Math.round((n.y - oy - C / 2) / C) });
    let solved = false;
    return $.updateFor(node, () => {
        const tiles = $(config.tiles).nodes;
        const total = config.cols * Math.ceil((tiles.length + 1) / config.cols);
        if ($.input.mousePressed('left')) {
            const m = $.input.mouseWorld();
            const hit = m && tiles.find((n) => Math.abs(n.x - m.x) < C / 2 && Math.abs(n.y - m.y) < C / 2);
            if (hit) {
                const a = cellOf(hit);
                const occupied = new Set(tiles.map((n) => { const k = cellOf(n); return k.r * config.cols + k.c; }));
                for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const c = a.c + dc, r = a.r + dr, idx = r * config.cols + c;
                    if (c < 0 || c >= config.cols || r < 0 || idx >= total || occupied.has(idx)) continue;
                    $(hit).at(ox + c * C + C / 2, oy + r * C + C / 2); node.emit('tile:move', {}); break;
                }
            }
        }
        const ok = tiles.length > 0 && tiles.every((n) => { const k = cellOf(n); return k.r * config.cols + k.c + 1 === Number($(n).data('n')); });
        if (ok && !solved) { solved = true; $.emit(config.solvedEvent, { puzzle: node.attr('id') }); }
        if (!ok) solved = false;
    });
}
