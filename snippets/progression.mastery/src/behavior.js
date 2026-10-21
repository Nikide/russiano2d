// Мастерство: data('mastery')[name] = { uses, level }.
export default function mastery(node, config, $) {
    const th = config.thresholds.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const all = node.data('mastery') || {};
    const m = all[config.name] || { uses: 0, level: 0 };
    const on = () => {
        m.uses++;
        const lv = th.filter((t) => m.uses >= t).length;
        if (lv > m.level) { m.level = lv; node.emit('mastery:up', { name: config.name, level: lv }); }
        all[config.name] = m;
        node.data('mastery', all);
    };
    node.on(config.event, on);
    return () => node.off(config.event, on);
}
