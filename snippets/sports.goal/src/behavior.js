// Гол: пересечение мяча с воротами; счёт — $.store score и глобальное goal.
export default function goal(node, config, $) {
    let cd = 0;
    return $.updateFor(node, (dt, self) => {
        if (cd > 0) { cd -= dt * 1000; return; }
        if (!$(config.ball).some((i, b) => self.overlaps(b))) return;
        cd = config.cooldown;
        const score = $.store.get('score', {});
        score[config.team] = (score[config.team] || 0) + 1;
        $.store.set('score', score);
        $.emit('goal', { team: config.team, score });
        $.emit('score', { id: config.team, points: 1 });
        $.emit('ball:reset', {});
    });
}
