// Карта: комнаты из событий room:enter (прямоугольники узлов), $.save visitedRooms.
export default function worldMap(node, config, $) {
    const visited = new Set($.save.get('visitedRooms') || []);
    const doc = $.ui.markup('snippets/world-map.rml', '<rml><head><style>body { width: 100%; height: 100%; } #map { position: absolute; left: 15%; top: 10%; width: 70%; height: 80%; background-color: #10141c; } .room { position: absolute; background-color: #4060a0; border-width: 1px; border-color: #a0c0ff; }</style></head><body><div id="map"></div></body></rml>');
    doc.hide();
    let open = false;
    const enter = (e) => { if (e.data && e.data.room) { visited.add(e.data.room); $.save.set('visitedRooms', [...visited]); } };
    const render = () => doc.html('map', [...visited].map((id) => { const r = $('#' + id); if (!r.length) return ''; const p = r.pos(), k = config.scale;
        return '<div class="room" style="left: ' + Math.round((p.x - r.width() / 2) * k) + 'px; top: ' + Math.round((p.y - r.height() / 2) * k) + 'px; width: ' + Math.max(2, Math.round(r.width() * k)) + 'px; height: ' + Math.max(2, Math.round(r.height() * k)) + 'px;"></div>'; }).join(''));
    $.on('room:enter', enter);
    const stop = $.updateFor(node, () => { if ($.input.pressed(config.key)) { open = !open; if (open) { render(); doc.show(); } else doc.hide(); } });
    return () => { stop(); $.off('room:enter', enter); doc.unload(); };
}
