// Область: crossfade при входе/выходе.
export default function musicZone(node, config, $) {
    let inside = false;
    return $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        const now = p.length && self.overlaps(p);
        if (now === inside) return;
        inside = now;
        if (inside) $.sound.crossfade(config.music, config.fade);
        else if (config.outside) $.sound.crossfade(config.outside, config.fade);
        else $.sound.stopMusic(config.fade);
    });
}
