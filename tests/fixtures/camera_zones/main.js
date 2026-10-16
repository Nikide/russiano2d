// Фикстура §19: зоны камеры, приоритеты и аренды.
//
// Уровень из двух комнат: «well» (вертикальная, зум ближе) и «hall»
// (горизонтальная, зум дальше). Проверяется, что зона — это данные, а не вторая
// камера, что приоритет решает конфликт, а аренда cutscene возвращает ровно
// прежнюю конфигурацию.

$.ready(($) => {
    $.world.gravity(0, 900).color('#0c1118').bounds(0, 0, 3000, 1500);
    $('<wall>', { id: 'floor' }).at(1500, 1200).size(3000, 40).appendTo($.world);
    $('<player>', { id: 'hero' }).at(400, 1100).size(24, 32).appendTo($.world);

    // Зоны уровня: границы, зум и политика следования. Порядок объявления не
    // важен — конфликт решает priority.
    $.camera.zone('well', {
        x: 0, y: 700, w: 900, h: 800, zoom: 1.25, priority: 5,
        follow: '#hero', offset: [0, 40],
    });
    $.camera.zone('hall', {
        x: 900, y: 700, w: 2100, h: 800, zoom: 0.8, priority: 1,
        follow: '#hero', offset: [0, 0],
    });

    $.agent.expose('camInfo', () => ({
        zoom: $.camera.zoom(),
        pos: $.camera.pos(),
        limits: $.camera.limits(),
        control: $.camera.control(),
        zones: $.camera.zone(),
    }));
    $.agent.expose('heroAt', () => ({ x: $('#hero').x(), y: $('#hero').y() }));
});
