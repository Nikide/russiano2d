// ===========================================================================
// Фикстура §20.2: материалы спрайтов, объявленный fallback нормалей и приёмка
// изображениями (свет слева/справа, ориентация узла, trimmed атлас, тень за
// движущимся occluder).
//
// Камера в центре кадра с зумом 1: МИРОВЫЕ координаты совпадают с экранными,
// поэтому тест читает яркость точки прямо из скриншота.
//
// Световое поле меряется ОДНОРОДНЫМИ прямоугольниками (`#field*`): у них нет
// запечённого затенения, и любая разница слева/справа — это свет, а не арт.
// Выпуклый спрайт `#convex` — для материала и скриншота.
//
// Ассеты собирает tests/fixtures/normal_map/make_assets.py.
// ===========================================================================

const ASSETS = 'tests/fixtures/normal_map/assets/';

$.ready(() => {
    $.camera.at(640, 360).zoom(1);
    $.world.gravity(0, 0).color('#05070d');
    $.gfx.light.ambient({ level: 0.55, color: '#05070d' });
    $.gfx.light.occluders([]);

    // Источник, которым тест двигает: слева/справа от светового поля.
    $('<light>', { id: 'lamp', radius: 260, intensity: 2.0, color: '#ffffff',
                   shadows: true, segments: 32 })
        .at(280, 220).blend('add').appendTo($.world);

    // --- Приёмка 1: световое поле слева/справа ------------------------------
    $('<rect>', { id: 'field' }).at(640, 220).size(160, 160)
        .color('#808080').appendTo($.world);
    // Выпуклый спрайт рядом — для материала и наглядности.
    $('<sprite>', { id: 'convex' }).at(640, 220).size(160, 160)
        .sprite(ASSETS + 'convex.png').hide().appendTo($.world);

    // --- Приёмка 2: material с normal-картой и без неё -----------------------
    // Три узла ставятся тестом в одну точку: при объявленном fallback все три
    // обязаны совпасть пиксель в пиксель.
    $.gfx.material('flat', { normal: ASSETS + 'flat_n.png', response: { diffuse: 1, ambient: 0.35 } });
    $.gfx.material('convex_n', { normal: ASSETS + 'convex_n.png', normalConvention: 'opengl',
                                 response: { diffuse: 1, ambient: 0.35 } });
    $('<sprite>', { id: 'mat_base' }).at(640, 480).size(96, 96)
        .sprite(ASSETS + 'convex.png').appendTo($.world);
    $('<sprite>', { id: 'mat_flat' }).at(640, 480).size(96, 96)
        .sprite(ASSETS + 'convex.png').material('flat').appendTo($.world);
    $('<sprite>', { id: 'mat_normal' }).at(640, 480).size(96, 96)
        .sprite(ASSETS + 'convex.png').material('convex_n').appendTo($.world);
    $('#mat_flat').hide();
    $('#mat_normal').hide();

    // --- Приёмка 3: ориентация узла при той же мировой позиции ---------------
    // Однородные прямоугольники: .flip() не меняет однотонную картинку, а свет
    // в объявленном fallback зависит только от мировой позиции.
    $('<rect>', { id: 'pose_plain' }).at(950, 220).size(160, 160)
        .color('#808080').appendTo($.world);
    $('<rect>', { id: 'pose_flip' }).at(950, 220).size(160, 160)
        .color('#808080').flip(true, false).hide().appendTo($.world);
    $('<rect>', { id: 'pose_rot' }).at(950, 220).size(160, 160)
        .color('#808080').angle(0.6).hide().appendTo($.world);

    // --- Приёмка 4: trimmed и полный кадр атласа в одной точке ---------------
    $.atlas.load('full', ASSETS + 'full.json');
    $.atlas.load('trim', ASSETS + 'trim.json');
    $('<sprite>', { id: 'trim_off' }).at(640, 620).size(64, 64)
        .sprite($.atlas.get('full').frame('full')).appendTo($.world);
    $('<sprite>', { id: 'trim_on' }).at(640, 620).size(64, 64)
        .sprite($.atlas.get('trim').frame('trim')).hide().appendTo($.world);

    // --- Приёмка 5: тень следует за движущимся occluder ----------------------
    $('<light>', { id: 'shadow_lamp', radius: 260, intensity: 2.0, color: '#ffd9a0',
                   shadows: true, segments: 32 })
        .at(1120, 300).blend('add').appendTo($.world);
    $('<rect>', { id: 'shadow_target' }).at(1120, 420).size(48, 48)
        .color('#3a4658').appendTo($.world);
    $('<rect>', { id: 'shadow_crate' }).at(1120, 360).size(28, 60)
        .occluders([{ x: -14, y: -30, w: 28, h: 60 }]).color('#8a6f4a').appendTo($.world);

    // --- API-факты для теста ------------------------------------------------
    $.store.set('perPixelNormal', $.gfx.perPixelNormal());
    $.store.set('normalPath', $.gfx.normalPath());
});
