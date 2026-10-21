// Проверка: data lastKnown от ai.line-of-sight / ai.hearing → дойти и событие investigate:done.
export default function investigate(node, config, $) {
    let goal = null;
    const start = () => { const lk = node.data('lastKnown'); if (lk) { goal = { x: lk.x, y: lk.y }; node.emit('investigate:start', goal); } };
    node.on('target:lost', start);
    node.on('heard', start);
    const stop = $.updateFor(node, (dt, self) => {
        if (!goal || self.data('sees')) return;
        const p = self.pos();
        if (Math.hypot(goal.x - p.x, goal.y - p.y) <= config.reach) { self.emit('investigate:done', goal); goal = null; self.velocity(0, self.velocity().y); return; }
        self.moveTowards(goal, config.speed);
    });
    return () => { stop(); node.off('target:lost', start); node.off('heard', start); };
}
