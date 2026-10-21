// Попадание: ограничение частоты, чтобы 30 ударов за кадр не дали 30 звуков.
export default function damageAudio(node, config, $) {
    let last = -1e9;
    const on = () => {
        const now = $.time.now();
        if (!config.sound || now - last < config.minGap) return;
        last = now;
        const p = node.pos();
        $.audio.playAt(config.sound, p.x, p.y);
    };
    node.on('damaged', on);
    return () => node.off('damaged', on);
}
