// Опыт: data('xp'); при пересечении порога — xp:threshold { index, value }.
export default function xp(node, config, $) {
    const th = config.thresholds.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    node.data('xp', node.data('xp') || 0);
    const on = (e) => {
        const before = Number(node.data('xp')) || 0, after = before + (Number(e.data && e.data.amount) || 0);
        node.data('xp', after).emit('xp:changed', { xp: after });
        th.forEach((t, i) => { if (before < t && after >= t) node.emit('xp:threshold', { index: i + 1, value: t }); });
    };
    node.on('xp', on);
    return () => node.off('xp', on);
}
