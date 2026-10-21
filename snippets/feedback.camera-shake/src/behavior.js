// Тяжёлый удар: damaged ≥ threshold → shake; reduceMotion — ослаблено.
export default function shakeOnHeavy(node, config, $) {
    const on = (e) => { if (e.data.amount >= config.threshold) $.camera.shake(config.strength * ($.store.get('reduceMotion', false) ? 0.3 : 1), config.ms); };
    node.on('damaged', on);
    return () => node.off('damaged', on);
}
