// Персонаж: узел-спрайт; позиции — доли ширины экрана.
const POS = { left: 0.2, center: 0.5, right: 0.8 };

export default function vnCharacter(node, config, $) {
    const em = Object.fromEntries(config.emotions.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    const handlers = config.cues.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, cue]) => [ev.trim(), () => {
        const [pos, e] = cue.split(':').map((x) => (x || '').trim());
        if (pos === 'hide') { node.fadeTo(0, 200); return; }
        if (POS[pos] !== undefined) node.at(1280 * POS[pos], node.pos().y);
        if (e && em[e]) node.sprite(em[e]);
        node.show().fadeTo(1, 200);
        node.data('emotion', e || node.data('emotion'));
        $.emit('vn:character', { name: config.name, pos, emotion: e });
    }]);
    node.data('name', config.name);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
