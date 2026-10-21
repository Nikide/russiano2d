// Призрак: точки [x, y] через every мс; лучший (самый короткий) — в $.save; играется с начала.
export default function ghost(node, config, $) {
    const rec = [];
    const best = $.save.get(config.key);
    let t = 0, tick = 0, ghostNode = null;
    if (best && best.points && best.points.length) ghostNode = $('<ghost>').size(node.width(), node.height()).color(config.color).alpha(0.4).appendTo($.world);
    const finish = () => {
        if (!best || !best.points || rec.length < best.points.length) $.save.set(config.key, { every: config.every, points: rec.slice() });
        node.emit('ghost:saved', { points: rec.length });
    };
    $.on(config.finishEvent, finish);
    const stop = $.updateFor(node, (dt, self) => {
        t += dt * 1000;
        if (t < config.every) return;
        t -= config.every;
        const p = self.pos();
        rec.push([Math.round(p.x), Math.round(p.y)]);
        if (ghostNode && best.points[tick]) ghostNode.at(best.points[tick][0], best.points[tick][1]);
        tick++;
    });
    return () => { stop(); $.off(config.finishEvent, finish); if (ghostNode) ghostNode.remove(); };
}
