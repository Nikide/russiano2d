// Клетки: $.nav.grid + buildFromWalls; событие grid:move { x, y } — путь A* в пределах moves.
export default function gridPathfinding(node, config, $) {
    const p0 = node.pos();
    const grid = $.nav.grid({ x: 0, y: 0, w: config.area[0], h: config.area[1], cell: config.cell, diagonal: false });
    if (grid && grid.buildFromWalls) grid.buildFromWalls({ tags: [config.walls.replace(/^\./, '')] });
    let path = [];
    const reachable = () => {
        if (!grid) return [];
        const s = grid.worldToCell(node.pos().x, node.pos().y), out = [], seen = new Set([s.cx + ',' + s.cy]);
        let frontier = [[s.cx, s.cy]];
        for (let d = 0; d < config.moves; d++) {
            const nxt = [];
            for (const [x, y] of frontier) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = (x + dx) + ',' + (y + dy);
                if (seen.has(k) || !grid.inBounds(x + dx, y + dy) || grid.isBlocked(x + dx, y + dy)) continue;
                seen.add(k); nxt.push([x + dx, y + dy]); out.push(grid.cellCenter(x + dx, y + dy));
            }
            frontier = nxt;
        }
        return out;
    };
    const move = (e) => {
        const d = e.data || {};
        const p = $.nav.pathOn(grid, node.pos(), { x: d.x, y: d.y }, { smooth: false });
        if (!p || p.length - 1 > config.moves) { node.emit('grid:denied', {}); return; }
        path = p.slice(1);
        node.emit('grid:path', { steps: path.length });
    };
    node.data('reachable', reachable());
    node.on('grid:move', move);
    void p0;
    const stop = $.updateFor(node, (dt, self) => {
        if (!path.length) return;
        const t = path[0], q = self.pos();
        if (Math.hypot(t.x - q.x, t.y - q.y) < 2) { self.at(t.x, t.y); path.shift(); if (!path.length) { self.data('reachable', reachable()); self.emit('grid:arrived', {}); } return; }
        self.moveTowards(t, config.speed);
    });
    return () => { stop(); node.off('grid:move', move); };
}
