// Параллакс: тот же механизм, что у Parallax-студии.
export default function parallaxLayer(node, config, $) {
    node.sprite(config.image).layer(config.layer);
    $.layers.parallax(node, config.factor);
    return () => $.layers.parallax(node, null);
}
