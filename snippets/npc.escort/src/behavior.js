// Сопровождение: следование; успех — пересечение destination; провал — смерть.
export default function escort(node, config, $) {
    let done = false;
    return $.updateFor(node, (dt, self) => {
        if (done) return;
        if (self.get(0).max_hp > 0 && self.hp() <= 0) { done = true; $.emit('escort:failed', { npc: self.attr('id') }); return; }
        if ($(config.destination).some((i, z) => self.overlaps(z))) { done = true; self.velocity(0, 0); $.emit('escort:done', { npc: self.attr('id') }); return; }
        const pl = $(config.player);
        if (pl.length && self.distanceTo(pl) > config.distance) self.moveTowards(pl, config.speed);
    });
}
