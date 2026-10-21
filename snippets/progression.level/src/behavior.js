// Уровень = 1 + число пройденных порогов; событие level:up { level, choices }.
export default function level(node, config, $) {
    node.data('level', node.data('level') || 1);
    const on = (e) => {
        const lv = 1 + e.data.index;
        if (lv <= (node.data('level') || 1)) return;
        node.data('level', lv);
        const raw = node.get(0);
        if (config.healOnLevel && raw.max_hp > 0) node.hp(raw.max_hp);
        node.emit('level:up', { level: lv, choices: config.choices.slice() });
    };
    node.on('xp:threshold', on);
    return () => node.off('xp:threshold', on);
}
