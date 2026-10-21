// Броня: amount − armor, но не меньше minimum (если урон вообще был).
export default function armor(node, config, $) {
    return node.damageFilter((info) => info.amount <= 0 ? 0 : Math.max(config.minimum, info.amount - config.armor));
}
