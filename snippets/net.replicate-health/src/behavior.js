// Здоровье: owner host, поле hp; на клиенте урон по узлу игнорируется фильтром.
export default function replicateHealth(node, config, $) {
    node.net({ id: node.attr('id'), owner: 'host', fields: ['x', 'y', 'hp'] });
    const off = node.damageFilter((info) => ($.net.online() && !$.net.isAuthority() ? 0 : info.amount));
    return () => { off(); $.net.unreplicate(node); };
}
