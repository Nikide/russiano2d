// Подбор по пересечению; событие 'collect' на подбирающем.
export default function collect(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const who = $(config.collector);
        if (!who.length || !self.overlaps(who)) return;
        if (config.sound) $.audio.play(config.sound);
        who.trigger('collect', { value: config.value });
        self.remove();
    });
}
