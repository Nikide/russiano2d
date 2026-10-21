// Спрайт узла из ресурса проекта.
export default function sprite(node, config, $) {
    node.sprite(config.image);
    return () => {};
}
