// Подбор по пересечению; событие 'collect' на подбирающем.
export default function collect(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.collector);
        if (!who.length || !self.overlaps(who)) return;
        if (config.sound) $.audio.play(config.sound);
        who.trigger('collect', { value: config.value });
        self.remove();
    });
}
