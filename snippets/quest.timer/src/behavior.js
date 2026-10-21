// Таймер: тикает, пока задание active; data('questTimer') на объекте.
export default function questTimer(node, config, $) {
    let left = config.time;
    return $.updateFor(node, (dt, self) => {
        if (!config.quest || $.quest.status(config.quest) !== 'active') { left = config.time; return; }
        left -= dt * 1000;
        self.data('questTimer', Math.max(0, left));
        if (left > 0) return;
        $.quest.cancel(config.quest);
        $.emit(config.failEvent, { quest: config.quest, reason: 'time' });
    });
}
