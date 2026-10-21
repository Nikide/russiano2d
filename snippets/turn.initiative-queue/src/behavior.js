// Очередь: сортировка по инициативе на начало раунда; ход переключается глобальным turn:next.
export default function initiativeQueue(node, config, $) {
    let order = [], i = -1, round = 0;
    const alive = (n) => !config.skipDead || !(n.max_hp > 0) || n.cur_hp > 0;
    const next = () => {
        if (i >= 0 && order[i] && !order[i].removed) $(order[i]).emit('turn:end', {});
        do {
            i++;
            if (i >= order.length) { order = $(config.units).nodes.slice().sort((a, b) => (Number($(b).data('initiative')) || 0) - (Number($(a).data('initiative')) || 0)); i = 0; round++; $.emit('round', { round }); }
        } while (order.length && (!alive(order[i]) || order[i].removed) && order.some(alive));
        if (!order.length) return;
        const cur = $(order[i]);
        $.store.set('turn', { round, unit: cur.attr('id') });
        cur.emit('turn:start', { round });
        $.emit('turn', { round, unit: cur.attr('id') });
    };
    $.on('turn:next', next);
    return () => $.off('turn:next', next);
}
