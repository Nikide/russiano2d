// Число урона: текстовый узел над объектом поднимается и исчезает.
export default function damageNumber(node, config, $) {
    const on = (e) => {
        if (!(e.data.amount > 0)) return;
        const p = node.pos();
        const t = $('<text>', { text: String(Math.round(e.data.amount)), size: config.size }).at(p.x, p.y - node.height() / 2).color(config.color).appendTo($.world);
        let left = config.life;
        $.updateFor(t, (dt, me) => {
            left -= dt * 1000;
            const q = me.pos();
            me.at(q.x, q.y - config.rise * dt * 1000 / config.life).alpha(Math.max(0, left / config.life));
            if (left <= 0) me.remove();
        });
    };
    node.on('damaged', on);
    return () => node.off('damaged', on);
}
