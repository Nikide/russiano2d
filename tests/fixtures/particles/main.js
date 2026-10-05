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
});

$.agent.expose('particlesCount', () => $.find('#fx').count());
