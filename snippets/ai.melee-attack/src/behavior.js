// Ближний бой: в агрессии — сближение, на дистанции — удар раз в cooldown.
export default function meleeAttack(node, config, $) {
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        if (cd > 0) cd -= dt * 1000;
        const tg = $(config.target);
        if (!tg.length || !tg.alive()) return;
        const d = self.distanceTo(tg);
        if (d > config.aggro) return;
        if (d > config.reach) { self.moveTowards(tg, config.speed); return; }
        if (cd > 0) return;
        cd = config.cooldown;
        tg.damage(config.damage, self, 'melee');
        self.emit('attack', { target: tg });
    });
}
