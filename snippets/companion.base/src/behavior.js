// Спутник: следует за лидером; дальше teleport — переносится к нему.
export default function companion(node, config, $) {
    node.addClass('companion');
    const stop = $.updateFor(node, (dt, self) => {
        const lead = $(config.leader);
        if (!lead.length) return;
        const d = self.distanceTo(lead);
        if (config.teleport > 0 && d > config.teleport) { const p = lead.pos(); self.at(p.x - config.distance, p.y); return; }
        if (d > config.distance) self.moveTowards(lead, config.speed);
    });
    return () => { stop(); node.removeClass('companion'); };
}
