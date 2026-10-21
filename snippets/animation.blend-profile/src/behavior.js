// Переход: при смене data('state') — $.anim.crossfade к клипу состояния.
export default function blendProfile(node, config, $) {
    const map = Object.fromEntries(config.states.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
    let cur = null;
    return $.updateFor(node, (dt, self) => {
        const st = self.data('state');
        if (!st || st === cur || !map[st]) return;
        cur = st;
        if ($.anim.has(map[st])) { $.anim.target(self); $.anim.crossfade(map[st], config.blend); }
        self.emit('anim:state', { state: st });
    });
}
