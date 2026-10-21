// Вспышка узла (.flash) по его событиям.
export default function flashOverlay(node, config, $) {
    const handlers = config.flashes.map((s) => s.split('=')).filter((p) => p.length === 2).map(([ev, col]) => [ev.trim(), () => node.flash(col.trim(), config.ms)]);
    for (const [ev, h] of handlers) node.on(ev, h);
    return () => { for (const [ev, h] of handlers) node.off(ev, h); };
}
