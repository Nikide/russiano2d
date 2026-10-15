// Фикстура проверки опции сборки R2D_ENABLE_RE2D (tests/agent/re2d_gate_test.py).
//
// Один и тот же файл запускается двумя сборками движка:
//   * build/     — RE2D=ON:  $.re2dEnabled истинно, $.re2d/mesh/cels есть;
//   * build-2d/  — RE2D=OFF: $.re2dEnabled ложно, этих объектов нет, а обычный
//                 2D-мир (узлы, тела, тайлмап, камера) работает как всегда.
//
// Игра при этом одна и та же: это и есть смысл опции — геймплейный код не
// меняется, меняется только доступность необязательного 3D-слоя.

$.ready(($) => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 1280, 720);

    // Обычный 2D-мир, который обязан работать в обеих сборках.
    $('<player>', { id: 'hero' }).at(200, 400).controls('wasd').appendTo($.world);
    $('<wall>', { id: 'floor', class: 'brick' }).at(200, 460).size(400, 24).appendTo($.world);
    $.tilemap.fromASCII([
        '11111111',
        '1......1',
        '11111111',
    ], { '1': 1, '.': 0 }, { id: 'map', tile: 32, solid: true }).at(560, 320);

    // Узел с видом Re2D: вид узла — это данные, он обязан приниматься в обеих
    // сборках (см. docs/highlevel/kinds.md). Отрисовывать его в сборке без RE2D
    // нечем, и это ожидаемо: проход вида не зарегистрирован.
    $('<npc>', { id: 'russi' }).at(400, 300).kind(Re2D).appendTo($.world);

    // Попытка включить вид камеры Re2D. В сборке без RE2D камера обязана
    // отказать внятной ошибкой (а не упасть на undefined.view) и остаться 2D.
    let cameraError = '';
    try {
        $.camera.kind(Re2D);
    } catch (error) {
        cameraError = String(error && error.message ? error.message : error);
    }
    const cameraKindAfter = $.camera.kind();
    $.camera.kind(null);

    // Снимок того, что видит игра: агент читает это одним eval.
    globalThis.__gate = {
        re2dEnabled: $.re2dEnabled,
        re2d: typeof $.re2d,
        mesh: typeof $.mesh,
        cels: typeof $.cels,
        rotSprite: typeof $.rotSprite,
        real2d: typeof $.real2d,
        kinds: $.kinds.list().map((k) => k.name).sort().join(','),
        heroKind: $('#hero').kind(),
        russiKind: $('#russi').kind(),
        cameraError,
        cameraKindAfter,
    };
});

$.agent.expose('gate', () => globalThis.__gate);
