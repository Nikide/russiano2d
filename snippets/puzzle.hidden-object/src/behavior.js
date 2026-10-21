// Поиск: клик мышью по объекту → класс found и событие found; список — data('toFind').
export default function hiddenObject(node, config, $) {
    let solved = false;
    return $.updateFor(node, () => {
        if ($.input.mousePressed('left')) {
            const m = $.input.mouseWorld();
            const hit = m && $(config.objects).nodes.map((n) => $(n)).find((w) => !w.hasClass('found') && Math.abs(w.pos().x - m.x) <= w.width() / 2 && Math.abs(w.pos().y - m.y) <= w.height() / 2);
            if (hit) { hit.addClass('found').flash('#ffff80', 200); node.emit('found', { id: hit.attr('id') }); }
        }
        const all = $(config.objects).nodes.map((n) => $(n));
        node.data('toFind', all.filter((w) => !w.hasClass('found')).map((w) => w.data('label') || w.attr('id')));
        if (!solved && all.length && all.every((w) => w.hasClass('found'))) { solved = true; $.emit(config.solvedEvent, { puzzle: node.attr('id') }); }
    });
}
