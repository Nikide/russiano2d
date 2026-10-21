// Здоровье через .health(); гибель — событие узла 'death'.
export default function health(node, config, $) {
    node.health(config.max);
    const onDeath = (e) => {
        if (config.onDeath === 'remove') e.self.remove();
        else if (config.onDeath === 'fade') e.self.fadeOut(200).then(() => e.self.remove());
    };
    node.on('death', onDeath);
    return () => node.off('death', onDeath);
}
