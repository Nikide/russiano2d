// ===========================================================================
// Фикстура §27 (хот-релоад ассетов).
//
// Ассеты на диске пишет сам тест ДО запуска: так он управляет содержимым и
// может менять его «на ходу», как это делает художник в preview.
//
//   assets/hot.png     — текстура для узла-спрайта (перезагрузка на месте);
//   assets/extra.png   — отдельная текстура для проверки отложенного
//                        освобождения handle'а;
//   assets/atlas.json  + assets/atlas.png — атлас с кадрами idle_0/run_0;
//   assets/map.json    — данные карты (клетки + признак solid);
//   assets/params.json — произвольные данные с validate-схемой;
//   ui/hud.rml + ui/hud.rcss — документ RmlUi (текст и стиль).
//
// Все четыре сценария приёмки §27 живут здесь: текстура, раскладка атласа,
// данные коллизии и стиль RmlUi. Сцена намеренно пустая и детерминированная.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // --- 1. Текстура: узел ссылается на неё по пути ------------------------
    $.resource.load('hot', 'assets/hot.png');
    $('<sprite>', { id: 'tex_node' }).size(64, 64).sprite('assets/hot.png')
        .at(120, 120).appendTo($.world);

    // --- 2. Атлас: узел держит спрайт кадра idle_0 -------------------------
    const sheet = $.atlas.load('hero', 'assets/atlas.json');
    $('<sprite>', { id: 'atlas_node' }).size(16, 16)
        .sprite(sheet ? sheet.frame('idle_0') : -1).at(240, 120).appendTo($.world);

    // --- 3. Карта: те же данные, что и в assets/map.json -------------------
    const map = $.tilemap.create({
        id: 'map', src: 'assets/tiles.png', tile: 16, cols: 4, rows: 4, solid: true,
        data: [
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
        ],
    });
    map.at(400, 300).appendTo($.world);

    // --- 4. RmlUi: документ, текст и стиль читаются тестом -----------------
    const hud = $.ui.doc('ui/hud.rml');
    if (hud && hud.id >= 0) hud.show();
    const hud_ext = $.ui.doc('ui/hud_ext.rml');
    if (hud_ext && hud_ext.id >= 0) hud_ext.show();

    // --- §27: граф зависимостей -------------------------------------------
    // Текстура атласа — отдельный ассет: atlas зависит от неё, как в §27
    // («atlas → pages/materials»).
    $.reload.watch('atlas_page', { kind: 'texture', path: 'assets/atlas.png',
                                   texture: () => ($.atlas.get('hero') ? $.atlas.get('hero').texture : -1) });
    $.reload.watch('atlas', { kind: 'atlas', path: 'assets/atlas.json', atlas: 'hero',
                              deps: ['atlas_page'] });
    $.reload.watch('tex', { kind: 'texture', path: 'assets/hot.png', resource: 'hot' });
    $.reload.watch('map', { kind: 'tilemap', path: 'assets/map.json', target: '#map' });
    $.reload.watch('hud', { kind: 'rml', path: 'ui/hud.rml' });
    // Второй документ со ВНЕШНИМ .rcss: проверка честного предупреждения о
    // кэше таблиц стилей RmlUi (§27, R2D_RELOAD_STYLE_CACHED).
    $.reload.watch('hud_ext', { kind: 'rml', path: 'ui/hud_ext.rml' });
    $.reload.watch('params', {
        kind: 'json', path: 'assets/params.json',
        validate: (d) => (d && typeof d.speed === 'number' && d.speed >= 0
            ? true : 'нужно поле speed: неотрицательное число'),
    });

    // --- Хелперы для теста (только факты) ---------------------------------
    const scope = $.scene.scope('reload_fixture');
    $.signal.on('reload:ping', () => {}, { scope });

    $.fixture = {
        scope,
        sheet: () => $.atlas.get('hero'),
        old_sheet: null,                     // тест запоминает прежнюю ссылку
        frame: (name) => { const s = $.atlas.get('hero'); return s ? s.frame(name) : -1; },
        tex_id: () => $.resource.get('hot'),
        atlas_sprite: () => $('#atlas_node').toArray()[0].sprite,
        tex_sprite: () => $('#tex_node').toArray()[0].sprite,
        hud_line: () => {
            const doc = $.ui.doc('ui/hud.rml');
            return doc && doc.id >= 0 ? doc.content('hud-line') : null;
        },
        hud_width: () => {
            const doc = $.ui.doc('ui/hud.rml');
            const r = doc && doc.id >= 0 ? doc.rect('hud-line') : null;
            return r ? Math.round(r.w) : 0;
        },
        map_cell: (x, y) => $('#map').tileAt(x, y),
        map_tile_pixel: (x, y) => $.tilemap.tileToPixel('#map', x, y),
        solids_at: (x, y) => $.world.bodyAt(x, y).toArray().length,
        counters: () => ({
            nodes: $.debug.counters().nodes,
            bodies: $.debug.counters().bodies,
            tweens: $.debug.counters().tweens,
            resources: $.resource.stats().total,
            textures: $.debug.limits().textures,
            sprites: $.debug.limits().sprites,
            subs: scope.counts().subs,
            scope_nodes: scope.counts().nodes,
        }),
    };
});
