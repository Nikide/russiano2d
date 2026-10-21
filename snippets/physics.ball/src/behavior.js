// Мяч: упругость — атрибут restitution до создания тела; удар — от касания игрока.
export default function ball(node, config, $) {
    node.addClass('ball');
    // Упругость Box2D читает только при создании тела: задаём до него; у готового тела — сообщаем.
    if (node.get(0).body >= 0) node.emit('ball:bounce-ignored', { reason: 'body-exists' });
    else node.attr('restitution', config.bounce).body('dynamic');
    const reset = () => { node.at(config.center[0], config.center[1]).velocity(0, 0).data('owner', null); node.emit('ball:reset', {}); };
    $.on('ball:reset', reset);
    const stop = $.updateFor(node, (dt, self) => {
        $(config.players).each((i, p) => {
            if (!self.overlaps(p)) return;
            const a = self.pos(), b = p.pos(), dx = a.x - b.x, dy = a.y - b.y, l = Math.hypot(dx, dy) || 1;
            self.velocity(dx / l * config.kick, dy / l * config.kick).data('owner', p.attr('id'));
            self.emit('ball:kick', { by: p.attr('id') });
        });
    });
    return () => { stop(); $.off('ball:reset', reset); };
}
