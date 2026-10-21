// Пары: клик мышью по карте открывает её (класс open); две разные закрываются.
export default function matching(node, config, $) {
    let open = [], wait = 0, solved = false;
    return $.updateFor(node, (dt) => {
        if (wait > 0) { wait -= dt * 1000; if (wait <= 0) { open.forEach((c) => c.removeClass('open')); open = []; } return; }
        if ($.input.mousePressed('left')) {
            const m = $.input.mouseWorld();
            const card = m && $(config.cards).nodes.map((n) => $(n)).find((c) => !c.hasClass('open') && !c.hasClass('matched') && Math.abs(c.pos().x - m.x) <= c.width() / 2 && Math.abs(c.pos().y - m.y) <= c.height() / 2);
            if (card) { card.addClass('open'); open.push(card); }
        }
        if (open.length === 2) {
            if (open[0].data('symbol') === open[1].data('symbol')) { open.forEach((c) => c.removeClass('open').addClass('matched')); open = []; node.emit('match', {}); }
            else wait = config.showMs;
        }
        const all = $(config.cards).nodes;
        if (!solved && all.length && all.every((n) => $(n).hasClass('matched'))) { solved = true; $.emit(config.solvedEvent, { puzzle: node.attr('id') }); }
    });
}
