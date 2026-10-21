
// Партия хранится у лидера: data('party') — массив id участников по порядку.
function partyOf(leader) { return (leader.data('party') || []).slice(); }

export default function partyFormation(node, config, $) {
    const id = node.attr('id');
    return $.updateFor(node, (dt, self) => {
        const l = $(config.leader);
        if (!l.length) return;
        const i = partyOf(l).indexOf(id);
        if (i < 0) return;
        const q = l.pos(), face = l.flip().x ? 1 : -1, p = self.pos();
        const spot = { x: q.x + face * config.spacing * (i + 1), y: q.y };
        if (Math.hypot(spot.x - p.x, spot.y - p.y) > 3) self.moveTowards(spot, config.speed); else self.velocity(0, self.velocity().y);
    });
}
