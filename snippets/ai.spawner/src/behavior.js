// Спавнер: экземпляры prefab в мире у себя; учитывает живых и общий лимит.
export default function spawner(node, config, $) {
    let on = !config.event, t = 0, made = 0;
    const live = [];
    const start = () => { on = true; };
    if (config.event) $.on(config.event, start);
    const stop = $.updateFor(node, (dt, self) => {
        if (!on || !config.prefab || !$.prefab.has(config.prefab)) return;
        for (let i = live.length - 1; i >= 0; i--) if (live[i].removed || live[i].cur_hp <= 0 && live[i].max_hp > 0) live.splice(i, 1);
        t -= dt * 1000;
        if (t > 0 || live.length >= config.alive || (config.total && made >= config.total)) return;
        t = config.interval;
        const p = self.pos();
        const w = $.prefab.instantiate(config.prefab, { x: p.x, y: p.y, parent: $.world });
        if (w && w.nodes) live.push(...w.nodes);
        made++;
        self.emit('spawn', { count: made });
        if (config.total && made >= config.total) self.emit('spawner:done', {});
    });
    return () => { stop(); if (config.event) $.off(config.event, start); };
}
