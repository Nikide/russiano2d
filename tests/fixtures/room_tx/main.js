// ===========================================================================
// Фикстура §23: комнаты как открытые данные + транзакция.
//
// Две комнаты (alpha/beta) описаны данными: bounds, карта, инстансы prefab,
// маркеры (спавн/выход) и exits с целью в другой комнате. Тест меняет данные
// «на ходу» и проверяет: визуал, коллизия и occluders едут вместе; неудачная
// загрузка не меняет мир; ссылка на отсутствующий маркер/комнату — ошибка.
//
// HUD и глобальная заметка созданы ВНЕ комнаты: смена комнаты их не трогает.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);
    $('<ui.panel>', { id: 'hud' }).at(120, 60).size(180, 40).text('HUD').appendTo($.ui);
    $('<rect>', { id: 'global_note' }).at(16, 16).size(8, 8).color('#4fd166').appendTo($.world);

    // --- prefab-данные (инстансы комнаты ссылаются на них по имени) --------
    $.prefab.register('torch', {
        tag: 'rect', id: 'torch', w: 16, h: 16, color: '#ffaa00',
        children: [{ tag: 'rect', id: 'flame', w: 8, h: 8, color: '#ffdd66' }],
    });
    $.prefab.register('door', {
        tag: 'wall', id: 'door', w: 32, h: 48,
        children: [{ tag: 'rect', id: 'lamp', w: 8, h: 8, color: '#8fd8ff' }],
    });

    // --- карты: 4×4, кольцо непроходимых клеток ---------------------------
    const cellsAlpha = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1];
    const cellsBeta = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

    function mapSpec(cells, room) {
        return {
            // Идентификатор карты уникален для комнаты: две комнаты со своим
            // узлом 'map' перекрыли бы друг друга в реестре идентификаторов.
            // mapW/mapH — ширина и высота в КЛЕТКАХ для плоского массива
            // (cols/rows — имена для слоёв и документации).
            id: 'map_' + room, data: cells.slice(), cols: 4, rows: 4, mapW: 4, mapH: 4,
            solid: true, mergeCollisions: false,    // 1 клетка = 1 тело: виден инкремент
            tileOccluders: true,                    // карта владеет реестром света
            src: 'assets/tiles.png', tile: 32, at: [640, 360],
        };
    }

    const mapSel = () => '#map_' + (($.room.current() && $.room.current().id) || 'alpha');

    $.fixture = {
        cellsAlpha: cellsAlpha.slice(),
        cellsBeta: cellsBeta.slice(),
        mapSpec,
        defineAlpha(extra) {
            return $.room.define('alpha', Object.assign({
                schema: 1, id: 'alpha', bounds: { x: 0, y: 0, w: 1280, h: 720 },
                tilemap: mapSpec(cellsAlpha, 'alpha'),
                instances: [{
                    prefab: 'torch', id: 'torch_a', x: 640, y: 300,
                    children: { flame: { id: 'torch_a/flame', color: '#ff0000' } },
                }],
                markers: { spawn: { x: 64, y: 64 }, exit_east: { x: 1240, y: 360, node: true } },
                exits: [{ id: 'east', marker: 'exit_east', to: 'beta', to_marker: 'spawn' }],
                connections: [{ from: 'east', to: 'beta', bidirectional: true }],
            }, extra || {}));
        },
        defineBeta(extra) {
            return $.room.define('beta', Object.assign({
                schema: 1, id: 'beta', bounds: { x: 0, y: 0, w: 1280, h: 720 },
                tilemap: mapSpec(cellsBeta, 'beta'),
                instances: [{ prefab: 'door', id: 'door_b', x: 320, y: 320 }],
                markers: { spawn: { x: 32, y: 32 } },
                exits: [{ id: 'west', marker: 'spawn', to: 'alpha', to_marker: 'spawn' }],
            }, extra || {}));
        },
        counters() {
            const c = $.debug.counters();
            return {
                nodes: c.nodes, bodies: c.bodies,
                subs: $.scene.scopeOf('room_fixture')
                    ? $.scene.scopeOf('room_fixture').counts().subs : 0,
                resources: $.resource.stats().total,
            };
        },
        mapSel,
        mapCell: (x, y) => $(mapSel()).tileAt(x, y),
        mapResult: () => $.tilemap.resultOf(mapSel()),
        occluders: () => $.tilemap.occludersOf(mapSel()).length,
        // Геометрия препятствий, а не число отрезков: у изменившегося
        // прямоугольника сторон столько же, но координаты другие.
        occluderHash: () => {
            // $.tilemap.occludersOf отдаёт ПЛОСКИЙ массив координат
            // (x1,y1,x2,y2 на отрезок) — хешируем значения, а не объекты.
            const segs = $.tilemap.occludersOf(mapSel());
            let h = segs.length;
            for (let i = 0; i < segs.length; i++) {
                const v = Number(segs[i]);
                h = (h * 31 + Math.round((isFinite(v) ? v : 0) * 100)) | 0;
            }
            return h;
        },
        pack: (hex) => $('<rect>').color(hex).toArray()[0].color,
        cellBody: (x, y) => {
            const p = $.tilemap.tileToPixel(mapSel(), x, y);
            return $.world.bodyAt(p.x, p.y).toArray().length;
        },
    };

    $.fixture.defineAlpha();
    $.fixture.defineBeta();
    // Подписка вне комнаты: смена комнаты не должна её терять.
    $.scene.scope('room_fixture');
    $.signal.on('room:ping', () => {}, { scope: 'room_fixture' });
});
