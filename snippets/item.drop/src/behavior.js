
// Выпавший предмет — узел в мире; подбирает collector касанием → $.emit('pickup').
function spawnPickup($, x, y, item, count, collector) {
    const n = $('<pickup>', { class: 'loot' }).at(x, y).size(10, 10).appendTo($.world);
    n.data('item', item).data('count', count);
    $.updateFor(n, (dt, me) => {
        const who = $(collector);
        if (!who.length || !me.overlaps(who)) return;
        $.emit('pickup', { item, count, by: who });
        me.remove();
    });
    return n;
}

export default function itemDrop(node, config, $) {
    let done = false;
    const drop = () => {
        if (done) return;
        done = true;
        const p = node.pos();
        config.drops.map((s) => s.split('=')).forEach(([id, n, chance], i) => {
            if (!id || !(Number(n) > 0)) return;
            if ($.random.chance(chance === undefined ? 1 : Number(chance))) spawnPickup($, p.x + (i - 1) * 12, p.y, id.trim(), Number(n), config.collector);
        });
    };
    node.on('death', drop);
    return () => node.off('death', drop);
}
