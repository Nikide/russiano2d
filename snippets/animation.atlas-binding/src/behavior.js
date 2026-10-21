// Атлас: $.atlas.load → tagSprites(тег) → .frames + .animate; состояние — data('state').
export default function atlasBinding(node, config, $) {
    const atlas = $.atlas.get(config.name) || $.atlas.load(config.name, config.atlas);
    if (!atlas) { node.emit('atlas:missing', { atlas: config.atlas }); return () => {}; }
    const map = Object.fromEntries(config.tags.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    let cur = null;
    const show = (st) => {
        const tag = map[st];
        if (!tag || st === cur) return;
        const frames = atlas.tagSprites(tag);
        if (!frames || !frames.length) return;
        cur = st;
        node.frames(frames).animate({ from: 0, to: frames.length - 1, speed: config.speed, loop: true });
    };
    show(node.data('state') || Object.keys(map)[0]);
    return $.updateFor(node, (dt, self) => { const st = self.data('state'); if (st) show(st); });
}
