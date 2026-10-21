// Профиль управления: .controls(scheme); снятие — .controls(false).
export default function controlProfile(node, config, $) {
    node.controls(config.scheme);
    return () => node.controls(false);
}
