// Ближний бой: в агрессии — сближение, на дистанции — удар раз в cooldown.
export default function meleeAttack(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        if (cd > 0) cd -= dt * 1000;
        const tg = sel(config.target);
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
