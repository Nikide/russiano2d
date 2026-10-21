// Миникарта — штатная $.camera.minimap; метки — её точки.
export default function minimapMarkers(node, config, $) {
    const marks = config.markers.map((s) => s.split('=')).filter((p) => p.length === 2).map(([sel, color]) => ({ sel: sel.trim(), color: color.trim() }));
    $.camera.minimap({ w: config.size[0], h: config.size[1], markers: marks });
    return () => $.camera.minimap(false);
}
