// ===========================================================================
// Фикстура §20.1: маска получателя света и слои источников.
//
// Две сцены:
//   * `accept` — геометрия приёмки: два СООСНЫХ источника (один слой) одинаковой
//     силы и цвета, два получателя на равном расстоянии и узел без маски. Всё
//     различие между получателями — только биты маски, поэтому яркость читается
//     как факт, а не как «дальше/ближе».
//   * `lights` — тяжёлая сцена для стенда (`tools/bench_stress.py --game
//     tests/fixtures/light_mask --scene lights`): 32 источника с тенями,
//     световая карта включена, ~130 спрайтов. Штатная сцена стенда «lights»
//     рисует свет прямо в сцену (lightmap выключен), поэтому цену накопления и
//     композита света её замер не измеряет вовсе.
//
// В фикстуре НЕТ вызовов нового API (`layer`/`lightMask`): она должна собираться
// и работать одинаково до и после изменения, чтобы замер «до/после» и проверка
// «узел без маски ведёт себя как раньше» были честными. Слои и маски ставит тест
// `tests/agent/light_receiver_mask_test.py`.
//
// Камера в центре кадра с зумом 1: МИРОВЫЕ координаты совпадают с экранными.
// ===========================================================================

const LAMP = { x: 640, y: 240 };
const RECV_Y = 420;
const RECV_DX = 110;   // оба получателя на равном расстоянии от источника

$.ready(() => {
    $.camera.at(640, 360).zoom(1);
    $.world.gravity(0, 0).color('#05070d');

    $.scene.add('accept', { enter($) { enterAccept($); } });
    $.scene.add('lights', { enter($) { enterBench($, false); } });
    // Тот же тяжёлый стенд, но все спрайты объявили маску получателя: так
    // замер показывается цена РАСШИРЕННОГО режима (проход маски + гейт).
    $.scene.add('lights_masked', { enter($) { enterBench($, true); } });
    $.scene.load('accept', { transition: 'none' });
});

function lightmapOn($) {
    // Световая карта: свет копится в отдельной текстуре половинного разрешения
    // и накладывается одним аддитивным композитом (r2d_render_draw_lights).
    $.gfx.light.map({ on: true, intensity: 1, soft: 0 });
    $.gfx.light.ambient.off();
    $.gfx.light.occluders([]);
}

function enterAccept($) {
    lightmapOn($);

    // Два соосных источника: одинаковая сила, радиус и цвет. Слои ставит тест —
    // по умолчанию источник освещает всех (прежнее поведение).
    for (const id of ['lamp_1', 'lamp_2']) {
        $('<light>', { id: id, radius: 300, intensity: 1.1, color: '#ffffff',
                       shadows: true, segments: 24 })
            .at(LAMP.x, LAMP.y).blend('add').appendTo($.world);
    }

    // Получатели: равное расстояние, одинаковая яркость поверхности. Маски
    // ставит тест.
    $('<rect>', { id: 'recv_1' }).at(LAMP.x - RECV_DX, RECV_Y).size(64, 64)
        .color('#9aa7bb').appendTo($.world);
    $('<rect>', { id: 'recv_2' }).at(LAMP.x + RECV_DX, RECV_Y).size(64, 64)
        .color('#9aa7bb').appendTo($.world);
    // Узел без маски — прежнее поведение: получает оба источника.
    $('<rect>', { id: 'plain' }).at(LAMP.x, RECV_Y).size(64, 64)
        .color('#9aa7bb').appendTo($.world);
    // `.lit(false)` ВНУТРИ радиуса источника: узел обязан остаться тёмным и при
    // включённой световой карте (иначе свет ложится поверх неосвещённого слоя).
    $('<rect>', { id: 'unlit' }).at(480, LAMP.y).size(64, 64)
        .color('#9aa7bb').lit(false).appendTo($.world);
    // Тень: движущийся occluder между источником и целью.
    $('<rect>', { id: 'shadow_target' }).at(300, 420).size(48, 48)
        .color('#9aa7bb').appendTo($.world);
    $('<rect>', { id: 'shadow_crate' }).at(300, 340).size(28, 60)
        .occluders([{ x: -14, y: -30, w: 28, h: 60 }]).color('#8a6f4a').appendTo($.world);
    $('<light>', { id: 'shadow_lamp', radius: 260, intensity: 1.4, color: '#ffffff',
                   shadows: true, segments: 24 })
        .at(300, 300).blend('add').appendTo($.world);
}

function enterBench($, masked) {
    lightmapOn($);
    for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        $('<light>', { radius: 150 + (i % 5) * 40, intensity: 0.7,
                       shadows: true, segments: 24,
                       color: i % 2 ? '#ffd27f' : '#7fd1ff' })
            .at(500 + Math.cos(angle) * (160 + (i % 4) * 90),
                320 + Math.sin(angle) * (120 + (i % 3) * 60))
            .blend('add').appendTo($.world);
    }
    for (let i = 0; i < 60; i++) {
        const n = $('<rect>', { class: 'wall' }).at(200 + i * 14, 240).size(10, 200)
            .color('#2a3140').appendTo($.world);
        if (masked) n.lightMask((i % 4) + 1);
    }
    for (let i = 0; i < 60; i++) {
        const n = $('<rect>', { class: 'wall' }).at(200 + i * 14, 620).size(10, 200)
            .color('#2a3140').appendTo($.world);
        if (masked) n.lightMask((i % 4) + 1);
    }
}
