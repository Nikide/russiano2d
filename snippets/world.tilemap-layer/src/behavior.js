// Слой: $.tilemap.create(данные файла) — обычный узел <tilemap>; ссылка — data('tilemapNode').
export default function tilemapLayer(node, config, $) {
    const data = $.fs.readJSON(config.map, null);
    if (!data) { node.emit('tilemap:missing', { map: config.map }); return () => {}; }
    const p = node.pos();
    const tm = $.tilemap.create(data).at(p.x, p.y).layer(config.layer).appendTo($.world);
    node.data('tilemapNode', tm.get(0)).emit('tilemap:ready', { map: config.map });
    return () => tm.remove();
}
