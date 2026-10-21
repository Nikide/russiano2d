// Площадь: $.world.query вокруг target; статус — событие узла status { kind: type }.
export default function areaEffect(node, config, $) {
    const cast = (e) => {
        if (e.data.id !== config.id) return;
        const t = e.data.target || node.pos();
        let n = 0;
        for (const raw of $.world.query(t.x, t.y, config.radius).nodes) {
            const w = $(raw);
            if (!w.is(config.targets)) continue;
            n++;
            if (config.effect === 'damage') w.damage(config.amount, node, config.type);
            else if (config.effect === 'heal') w.heal(config.amount);
            else w.emit('status', { kind: config.type });
        }
        node.emit('ability:area', { id: config.id, x: t.x, y: t.y, radius: config.radius, hits: n });
    };
    node.on('ability:cast', cast);
    return () => node.off('ability:cast', cast);
}
