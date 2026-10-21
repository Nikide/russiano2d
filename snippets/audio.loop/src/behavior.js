// Петля: хэндл $.audio.play с loop; снятие — stop.
export default function audioLoop(node, config, $) {
    let h = $.audio.play(config.sound, { loop: true, volume: config.volume });
    const stopIt = () => { if (h && h.stop) h.stop(); h = null; };
    if (config.stopEvent) $.on(config.stopEvent, stopIt);
    return () => { stopIt(); if (config.stopEvent) $.off(config.stopEvent, stopIt); };
}
