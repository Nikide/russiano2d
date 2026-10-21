// Лидер: периодически раздаёт цель участникам; они решают сами (ai.*), как её достичь.
export default function squadLeader(node, config, $) {
    let t = 0;
    node.addClass('squad-leader');
    return $.updateFor(node, (dt, self) => {
        t -= dt * 1000;
        if (t > 0) return;
        t = config.every;
        const g = $(config.goal);
        const goal = g.length ? g.pos() : self.pos();
        $(config.members).each((i, m) => { m.data('squadGoal', goal).data('squadLeader', self.attr('id')); m.emit('squad:goal', { goal, leader: self }); });
    });
}
