
// Рядом ли actor и нажата ли клавиша действия.
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

export default function savePoint(node, config, $) {
    node.addClass('interactive').data('prompt', 'Сохранить');
    return $.updateFor(node, (dt, self) => {
        if (!nearPress($, self, config)) return;
        const ok = $.save.slot(config.saveSlot).save({ meta: { point: self.attr('id') } });
        self.emit(ok === false ? 'save:failed' : 'save:done', { slot: config.saveSlot });
    });
}
