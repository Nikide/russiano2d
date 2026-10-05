// Фикстура тестов пула объектов ($.pool).
//
// Два пула: «bullets» без физики (проверяем переиспользование и лимит роста)
// и «shots» с телом Box2D (проверяем, что release уничтожает тело, а spawn
// создаёт заново). Счётчики пулов публикуются агенту.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // Видимая опора: проверяем, что сцена живёт и камера не уехала.
    $('<rect>', { id: 'marker' }).at(40, 40).size(20, 20).appendTo($.world);

    $.pool.create({
        name: 'bullets',
        tag: 'rect',
        max: 3,
        initial: 1,
        w: 8,
        h: 8,
        color: '#ffd34d',
        onAcquire: (node) => { node.attrs.acquired = (node.attrs.acquired || 0) + 1; },
        onRelease: (node) => { node.attrs.released = (node.attrs.released || 0) + 1; },
    });

    $.pool.create({ name: 'shots', tag: 'bullet', max: 2, w: 6, h: 6, speed: 600 });
});

$.agent.expose('poolStats', () => $.pool.stats());
