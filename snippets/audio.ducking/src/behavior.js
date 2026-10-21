// Даккинг: громкость шины музыки вниз, потом обратно.
export default function ducking(node, config, $) {
    let left = 0, before = null;
    const duck = () => { if (before === null) before = $.audio.musicVolume(); $.audio.musicVolume(before * config.level); left = config.hold; };
    for (const ev of config.events) $.on(ev, duck);
    const stop = $.updateFor(node, (dt) => { if (left <= 0) return; left -= dt * 1000; if (left <= 0 && before !== null) { $.audio.musicVolume(before); before = null; } });
    return () => { stop(); for (const ev of config.events) $.off(ev, duck); if (before !== null) $.audio.musicVolume(before); };
}
