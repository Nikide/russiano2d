// Владение: .net({ id, owner, fields }); снятие — unreplicate.
export default function playerOwner(node, config, $) {
    node.net({ id: config.netId || node.attr('id'), owner: config.owner, fields: config.fields });
    return () => $.net.unreplicate(node);
}
