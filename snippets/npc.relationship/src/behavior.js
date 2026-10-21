// Отношение: node.emit('relationship', { delta }) → data, класс rel-friend/rel-enemy/rel-neutral.
export default function relationship(node, config, $) {
    let v = config.start, tier = '';
    const apply = () => {
        const t = v >= config.friend ? 'friend' : v <= config.enemy ? 'enemy' : 'neutral';
        node.data('relationship', v);
        if (t === tier) return;
        if (tier) node.removeClass('rel-' + tier);
        tier = t; node.addClass('rel-' + t); node.emit('relationship:' + t, { value: v });
    };
    const on = (e) => { v = Math.max(-100, Math.min(100, v + (Number(e.data && e.data.delta) || 0))); apply(); };
    node.on('relationship', on);
    apply();
    return () => node.off('relationship', on);
}
