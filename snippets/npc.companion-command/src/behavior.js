// Команда в data('command'): follow — следование отдаёт npc.companion-follow; wait — стоит; attack — к врагу.
export default function companionCommand(node, config, $) {
    let cd = 0;
    node.data('command', 'follow');
    return $.updateFor(node, (dt, self) => {
        if ($.input.pressed(config.followKey)) self.data('command', 'follow').emit('command', { command: 'follow' });
        if ($.input.pressed(config.waitKey)) self.data('command', 'wait').emit('command', { command: 'wait' });
        if ($.input.pressed(config.attackKey)) self.data('command', 'attack').emit('command', { command: 'attack' });
        const c = self.data('command');
        if (c === 'wait') { self.velocity(0, self.velocity().y); return; }
        if (c !== 'attack') return;
        cd -= dt * 1000;
        const p = self.pos();
        let best = null;
        $(config.enemies).each((i, e) => { if (!e.alive()) return; const d = self.distanceTo(e); if (!best || d < best.d) best = { e, d }; });
        if (!best) { self.data('command', 'follow'); return; }
        if (best.d > 24) { self.moveTowards(best.e, config.speed); return; }
        if (cd <= 0) { cd = config.cooldown; best.e.damage(config.damage, self, 'melee'); }
        void p;
    });
}
