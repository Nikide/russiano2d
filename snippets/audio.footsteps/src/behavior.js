
// «событие=файл» → [[событие, файл], …]
function cues(list) { return list.map((s) => s.split('=')).filter((p) => p.length === 2 && p[0].trim() && p[1].trim()).map(([a, b]) => [a.trim(), b.trim()]); }

export default function footsteps(node, config, $) {
    const map = cues(config.surfaces);
    let dist = 0;
    return $.updateFor(node, (dt, self) => {
        const v = self.velocity();
        if (!self.onFloor() || Math.abs(v.x) < 5) return;
        dist += Math.abs(v.x) * dt;
        if (dist < config.stride) return;
        dist = 0;
        const p = self.pos(), under = $.world.query(p.x, p.y + self.height() / 2 + 3, 2).nodes;
        const hit = map.find(([cls]) => under.some((n) => $(n).hasClass(cls.replace(/^\./, ''))));
        const src = hit ? hit[1] : config.default;
        if (src) $.audio.playAt(src, p.x, p.y);
        self.emit('footstep', {});
    });
}
