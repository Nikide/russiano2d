// Отклик: только визуальный (не меняет hp/позицию); отказ — красная вспышка.
export default function lagSafeFeedback(node, config, $) {
    const ok = () => node.flash(config.color, 80);
    const bad = () => node.flash('#ff3030', 160);
    for (const ev of config.events) node.on(ev, ok);
    $.net.on(config.deniedEvent, bad);
    return () => { for (const ev of config.events) node.off(ev, ok); $.net.off(config.deniedEvent, bad); };
}
