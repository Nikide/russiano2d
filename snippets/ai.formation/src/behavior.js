// Строй: смещение места от лидера; движение к нему.
function offset(shape, slot, spacing) {
    if (shape === 'circle') { const a = slot * 2 * Math.PI / 8; return { x: Math.cos(a) * spacing * 1.5, y: Math.sin(a) * spacing * 1.5 }; }
    const row = Math.ceil(slot / 2), side = slot % 2 ? -1 : 1;
    if (shape === 'wedge') return { x: -row * spacing, y: side * row * spacing };
    return { x: -slot * spacing, y: 0 };
}

export default function formation(node, config, $) {
    const off = offset(config.shape, config.position, config.spacing);
    return $.updateFor(node, (dt, self) => {
        const l = $(config.leader);
        if (!l.length) return;
        const q = l.pos(), face = l.flip().x ? -1 : 1, p = self.pos();
        const spot = { x: q.x + off.x * face, y: q.y + off.y };
        if (Math.hypot(spot.x - p.x, spot.y - p.y) > 3) self.moveTowards(spot, config.speed); else self.velocity(0, 0);
    });
}
