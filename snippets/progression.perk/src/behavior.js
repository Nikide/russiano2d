// Перк: фильтр урона включается, только когда условие выполнено.
export default function perk(node, config, $) {
    const active = () => (config.skill && (node.data('skills') || []).includes(config.skill)) || (config.flag && !!node.data(config.flag));
    return node.damageFilter((info) => active() ? info.amount * config.damageTaken : info.amount);
}
