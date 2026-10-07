// Фикстура теста `$('.enemy').within(...)` (tests/agent/highlevel_within_test.py).
//
// Мир нарочно расставлен по числам: гравитация выключена, тела статические,
// у каждого узла известная координата. Поэтому ответ запроса проверяется
// арифметикой, а не «на глаз».
//
// Расстояния от героя (100, 100):
//   enemy0 (300, 100) — 200 px, есть тело
//   enemy1 (500, 100) — 400 px, есть тело
//   enemy2 (1000, 100) — 900 px, есть тело
//   marker (150, 100) — 50 px, тела НЕТ (спрайт: проверяет путь по координатам)
//   far    (2000, 100) — 1900 px, тела нет
$.ready(() => {
    $.world.gravity(0, 0).color('#000000');

    $('<player>', { id: 'hero', w: 16, h: 16 }).at(100, 100)
        .body('static').appendTo($.world);

    [[300, 'enemy0'], [500, 'enemy1'], [1000, 'enemy2']].forEach(([x, id]) => {
        $('<enemy>', { id, class: 'goblin enemy', w: 16, h: 16 }).at(x, 100)
            .body('static').appendTo($.world);
    });

    $('<sprite>', { id: 'marker', class: 'goblin', w: 16, h: 16 })
        .at(150, 100).appendTo($.world);
    $('<sprite>', { id: 'far', w: 16, h: 16 }).at(2000, 100).appendTo($.world);
});
