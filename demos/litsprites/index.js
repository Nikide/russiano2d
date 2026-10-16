// ===========================================================================
// Пример §31-5 Спецификации: «Lit sprites».
//
// Один законченный сценарий на существующем `$`: 2D-свет, маски препятствий,
// динамический occluder, неосвещённые узлы, материал с normal-картой и без неё,
// кадры атласа с отражением по X/Y.
//
//   * два источника с тенями и РАЗНЫМИ масками препятствий: препятствие с
//     чужими битами источник не видит, и цель за ним остаётся светлой;
//   * динамический occluder `#crate` — свой список `.occluders([...])` в
//     локальных пикселях; скрытый узел препятствием не считается;
//   * `#sign` с `.lit(false)` — ни света, ни темноты: виден в полной темноте;
//   * материал `stone` с normal-картой и спрайт без материала: движок хранит
//     normal как данные и рисует нейтральную норму (`perPixelNormal === false`,
//     §20.2) — картинка совпадает, это зафиксированное ограничение;
//   * кадры атласа с padding 2 / extrusion 1: `.flip(true/false, …)` зеркалит
//     кадр, мипмапы включены (§22) и на соседний кадр не протекают;
//   * HUD — RmlUi: мировой свет и темнота его не касаются.
//
// Камера стоит в центре кадра с зумом 1, поэтому МИРОВЫЕ координаты совпадают
// с экранными: тест читает яркость точки прямо из скриншота.
//
// Запуск и проверка — demos/litsprites/README.md, tests/agent/litsprites_test.py.
// Только `$`: ни `engine.*`, ни импорта внутренностей движка.
// ===========================================================================

export default function install($) {
    const state = { crateDir: 1, crateY: 300, showDebug: false };

    $.scene.add('litsprites', {
        enter($) { enter($, state); },
        update(dt, $) { tick($, dt, state); },
    });
}

// ---------------------------------------------------------------------------
// Геометрия сцены (мир == экран, 1280×720)
// ---------------------------------------------------------------------------

const LAMP_A = { x: 200, y: 300 };     // тёплый, маска препятствий 1
const LAMP_B = { x: 1080, y: 300 };    // холодный, маска препятствий 2
const TARGET_A = { x: 320, y: 300 };   // в луче лампы A, за препятствием маски 1
const TARGET_B = { x: 960, y: 300 };   // в луче лампы B, за препятствием маски 2
const OBSTACLE_A = { x: 260, y: 220, w: 32, h: 160, mask: 1 };
const OBSTACLE_B = { x: 1020, y: 220, w: 32, h: 160, mask: 2 };
const CRATE = { w: 32, h: 48, patrol: [160, 380] };

function enter($, state) {
    $.world.gravity(0, 0).color('#05070d');
    // Мир == экран: камера в центре кадра, зум 1.
    $.camera.at(640, 360).zoom(1);
    $.gfx.light.ambient({ level: 0.55, color: '#05070d' });

    buildArena($);
    buildLights($);
    buildTargets($);
    buildMaterials($, state);
    buildAtlasFrames($, state);
    buildHud($);

    $.store.set('crateMove', true);
    $.store.set('maskA', 1);
    $.store.set('maskB', 2);
}

function buildArena($) {
    // Пол и стены: свет падает на них, тени от препятствий видны.
    $('<rect>', { id: 'floor' }).at(640, 660).size(1280, 120).color('#2b3240').appendTo($.world);
    $('<rect>', { id: 'back' }).at(640, 420).size(1280, 360).color('#161b26').appendTo($.world);
    // Неосвещённый указатель: `.lit(false)` — вне света, тумана и темноты.
    $('<rect>', { id: 'sign' }).at(640, 560).size(160, 40).color('#8fd0ff')
        .lit(false).appendTo($.world);
    // Лампы-маркеры самих источников: маленькие яркие квадраты.
    $('<rect>', { id: 'bulb_a' }).at(LAMP_A.x, LAMP_A.y).size(10, 10).color('#ffd9a0')
        .lit(false).appendTo($.world);
    $('<rect>', { id: 'bulb_b' }).at(LAMP_B.x, LAMP_B.y).size(10, 10).color('#cfe4ff')
        .lit(false).appendTo($.world);
}

function buildLights($) {
    // Реестр препятствий: у каждого свои биты маски. Источник с `.occluderMask(1)`
    // видит первое и не видит второе — §20.1 (маска препятствий).
    $.gfx.light.occluders([OBSTACLE_A, OBSTACLE_B]);

    $('<light>', { id: 'lamp_a', radius: 260, intensity: 2.0, color: '#ffbe73',
                   shadows: true, segments: 48 })
        .at(LAMP_A.x, LAMP_A.y).blend('add').occluderMask(1).appendTo($.world);
    $('<light>', { id: 'lamp_b', radius: 260, intensity: 2.0, color: '#88bbff',
                   shadows: true, segments: 48 })
        .at(LAMP_B.x, LAMP_B.y).blend('add').occluderMask(2).appendTo($.world);

    // Динамический occluder: прямоугольник в ЛОКАЛЬНЫХ пикселях узла.
    $('<rect>', { id: 'crate' }).at(1020, CRATE.patrol[0]).size(CRATE.w, CRATE.h)
        .color('#8a6f4a')
        .occluders([{ x: -CRATE.w / 2, y: -CRATE.h / 2, w: CRATE.w, h: CRATE.h }])
        .appendTo($.world);
}

function buildTargets($) {
    $('<rect>', { id: 'target_a' }).at(TARGET_A.x, TARGET_A.y).size(48, 48)
        .color('#3a4658').appendTo($.world);
    $('<rect>', { id: 'target_b' }).at(TARGET_B.x, TARGET_B.y).size(48, 48)
        .color('#3a4658').appendTo($.world);
    // Контрольная цель рядом с лампой A, но ВНЕ тени: на том же радиусе.
    $('<rect>', { id: 'target_free' }).at(TARGET_A.x, 460).size(48, 48)
        .color('#3a4658').appendTo($.world);
}

function buildMaterials($, state) {
    // Материал с normal-картой: движок сохраняет её как данные, но попиксельный
    // свет по ней не считает — оба спрайта обязаны выглядеть одинаково.
    $.gfx.material('stone', {
        normal: 'demos/litsprites/assets/normal.png',
        normalConvention: 'opengl',
        response: { diffuse: 1, ambient: 0.25 },
    });
    $('<rect>', { id: 'mat_normal' }).at(320, 480).size(56, 56)
        .color('#c8c8c8').material('stone').appendTo($.world);
    $('<rect>', { id: 'mat_flat' }).at(420, 480).size(56, 56)
        .color('#c8c8c8').appendTo($.world);
    state.material = 'stone';
}

function buildAtlasFrames($, state) {
    // Атлас с padding 2 / extrusion 1: мипмапы разрешены (§22).
    const sheet = $.atlas.load('flip', 'demos/litsprites/assets/atlas.json', { mipmaps: true });
    const all = sheet.tagSprites('all');
    state.atlas = sheet;

    // Три кадра одного и того же спрайта: как есть, отражён по X, отражён по Y.
    // Кадр `half` асимметричен (левая половина зелёная, правая красная, метка в
    // левом верхнем углу) — по нему видно и флип, и протечку на соседа.
    $('<sprite>', { id: 'frame_plain' }).at(300, 140).size(64, 64)
        .frames(all).frame(0).appendTo($.world);
    $('<sprite>', { id: 'frame_flipx' }).at(400, 140).size(64, 64)
        .frames(all).frame(0).flip(true, false).appendTo($.world);
    $('<sprite>', { id: 'frame_flipy' }).at(500, 140).size(64, 64)
        .frames(all).frame(0).flip(false, true).appendTo($.world);
    // Сосед по атласу (`blue`) — не анимация, а контроль протечки: он стоит
    // рядом в листе, и его цвет не должен появляться на краю кадра `half`.
    $('<sprite>', { id: 'frame_neighbor' }).at(600, 140).size(64, 64)
        .frames(all).frame(1).appendTo($.world);
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

function tick($, dt, state) {
    // Демонстрация динамического occluder: ящик ездит вертикально и роняет
    // тень на цель. Тест выключает движение (`$.store.set('crateMove', false)`)
    // и ставит ящик сам — тогда яркость читается в известной точке.
    if ($.store.get('crateMove', true)) {
        state.crateY += state.crateDir * 60 * dt;
        if (state.crateY > CRATE.patrol[1]) { state.crateY = CRATE.patrol[1]; state.crateDir = -1; }
        if (state.crateY < CRATE.patrol[0]) { state.crateY = CRATE.patrol[0]; state.crateDir = 1; }
        $('#crate').at(1020, state.crateY);
    }
    hud($, state);
}

// ---------------------------------------------------------------------------
// HUD — RmlUi, вне мирового света
// ---------------------------------------------------------------------------

function buildHud($) {
    $('<ui.panel>', { id: 'hud' }).at(300, 60).size(470, 96)
        .color('#101828').appendTo($.ui);
    $('<ui.label>', { id: 'hud-title', size: 18, color: '#e8f0ff' }).at(300, 30).appendTo($.ui);
    $('<ui.label>', { id: 'hud-lights', size: 15, color: '#9fb3cc' }).at(300, 56).appendTo($.ui);
    $('<ui.label>', { id: 'hud-hint', size: 15, color: '#9fb3cc' }).at(300, 82).appendTo($.ui);
}

function hud($, state) {
    const stats = $.gfx.light.stats ? $.gfx.light.stats() : null;
    $('#hud-title').text('Lit sprites: маски, окклюзия, атлас');
    $('#hud-lights').text(stats
        ? `Источников: ${stats.lights} · с тенями: ${stats.shadowLights} · отрезков: ${stats.occluders}`
        : 'Свет: счётчики недоступны');
    $('#hud-hint').text('Ящик ездит сам: свет и тень следуют за ним');
}
