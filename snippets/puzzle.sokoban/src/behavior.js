// Пошаговый сокобан: шаг игрока на клетку ящика двигает ящик дальше, если там пусто.
export default function sokoban(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const C = config.cell, snap = (v) => Math.round(v / C) * C;
    const at = (sel, x, y) => $(sel).nodes.find((n) => snap(n.x) === x && snap(n.y) === y);
    let solved = false;
    return $.updateFor(node, () => {
        const p = sel(config.player);
        if (!p.length) return;
        let dx = 0, dy = 0;
        if ($.input.pressed('d') || $.input.pressed('right')) dx = 1; else if ($.input.pressed('a') || $.input.pressed('left')) dx = -1;
        else if ($.input.pressed('s') || $.input.pressed('down')) dy = 1; else if ($.input.pressed('w') || $.input.pressed('up')) dy = -1;
        if (dx || dy) {
            const q = p.pos(), x = snap(q.x) + dx * C, y = snap(q.y) + dy * C;
            if (!at(config.walls, x, y)) {
                const box = at(config.boxes, x, y);
                if (!box) p.at(x, y);
                else if (!at(config.walls, x + dx * C, y + dy * C) && !at(config.boxes, x + dx * C, y + dy * C)) { $(box).at(x + dx * C, y + dy * C); p.at(x, y); node.emit('sokoban:push', {}); }
            }
        }
        const goals = $(config.goals).nodes;
        const ok = goals.length > 0 && goals.every((g) => at(config.boxes, snap(g.x), snap(g.y)));
        if (ok && !solved) { solved = true; $.emit(config.solvedEvent, { puzzle: node.attr('id') }); }
    });
}
