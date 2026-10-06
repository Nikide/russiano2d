// Фикстура тестов CPU-частиц: один декларативный эмиттер в центре экрана,
// опора для камеры и публикация счётчика частиц для агента.
$.ready(() => {
    $.world.gravity(0, 900).color('#101820').bounds(0, 0, 1280, 720);

    $('<particles>', {
        id: 'fx',
        amount: 16,
        rate: 120,
        lifetime: 1000,
        speed: [40, 90],
        spread: 360,
        gravity: [0, 120],
        size: [4, 8],
        seed: 7,
    }).at(400, 300).appendTo($.world);

    // Видимая опора: проверяем, что сцена вообще живёт и камера не уехала.
    $('<rect>', { id: 'marker' }).at(40, 40).size(20, 20).appendTo($.world);

    // Неподвижное облако для проверок «частицы как цели»: нулевая скорость и
    // гравитация — частицы висят в точке эмиттера, поэтому попадания
    // детерминированы и не зависят от порядка кадров.
    $('<particles>', {
        id: 'target',
        amount: 5,
        one_shot: true,
        lifetime: 60000,
        speed: 0,
        gravity: 0,
        size: 24,
        end_size: 24,
        seed: 3,
    }).at(600, 500).appendTo($.world);
});

$.agent.expose('particlesCount', () => $.find('#fx').count());
