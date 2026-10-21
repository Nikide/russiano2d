// Профиль: хост отправляет hostFields; владелец — clientFields (через owner local/client).
export default function authorityProfile(node, config, $) {
    const id = node.attr('id');
    node.net({ id, owner: $.net.isAuthority() ? 'host' : 'remote', fields: config.hostFields });
    node.data('authorityFields', { host: config.hostFields, client: config.clientFields });
    return () => $.net.unreplicate(node);
}
