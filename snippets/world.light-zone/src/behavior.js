// Свет: свойства узла; мерцание — шум яркости.
export default function lightZone(node, config, $) {
    node.radius(config.radius).intensity(config.intensity).color(config.color);
    if (!config.flicker) return () => {};
    let t = 0;
    return $.updateFor(node, (dt, self) => { t += dt; self.intensity(config.intensity * (1 - config.flicker * (0.5 + 0.5 * Math.sin(t * 13) * Math.sin(t * 7.3)))); });
}
