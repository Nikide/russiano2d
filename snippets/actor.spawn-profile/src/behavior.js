// Профиль появления: один раз задаёт позицию/размер/угол.
export default function spawnProfile(node, config, $) {
    node.at(config.position[0], config.position[1]).size(config.size[0], config.size[1]).angle(config.angle);
    return () => {};
}
