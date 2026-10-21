// Цепочка: следующее задание берётся, когда предыдущее done.
export default function questSequence(node, config, $) {
    return $.updateFor(node, () => {
        for (let i = 0; i < config.quests.length; i++) {
            const id = config.quests[i], st = $.quest.status(id);
            if (st === 'ready' && config.autoTurnIn) { $.quest.turnIn(id); $.emit('quest:stage', { quest: id, index: i }); }
            if (st === 'done') continue;
            if (st === 'available' && (i === 0 || $.quest.status(config.quests[i - 1]) === 'done')) $.quest.accept(id);
            break;
        }
    });
}
