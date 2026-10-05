// Фикстура теста зон-триггеров: дверь, ловушка, зона с detect и стена.
//
// Мир без гравитации — позиции тел стабильны, тест двигает их через .at().
// Игрок — единственное тело, которое ходит; остальные узлы стоят на месте.
$.ready(() => {
    $.world.color('#101820');
    $.world.gravity(0, 0);

    // Счётчики: тест читает их через a.eval.
    $.store.set('doorEnter', 0);
    $.store.set('doorLeave', 0);
    $.store.set('lastOther', '');
    $.store.set('trapEnter', 0);
    $.store.set('trapLeave', 0);
    $.store.set('detectEnter', 0);

    // --- Игрок ------------------------------------------------------------
    $('<player>', { id: 'hero' }).at(100, 100).appendTo($.world);

    // --- Зона-дверь: считает входы и выходы -------------------------------
    $('<trigger>', { id: 'door' }).at(300, 300).size(80, 80).appendTo($.world)
        .on('enter', (e) => {
            $.store.set('doorEnter', $.store.get('doorEnter') + 1);
            $.store.set('lastOther', e.data.other.get(0).id);
        })
        .on('leave', () => $.store.set('doorLeave', $.store.get('doorLeave') + 1));

    // --- Ловушка: проверяем исчезновение цели (remove) --------------------
    $('<trigger>', { id: 'trap' }).at(600, 500).size(60, 60).appendTo($.world)
        .on('enter', () => $.store.set('trapEnter', $.store.get('trapEnter') + 1))
        .on('leave', () => $.store.set('trapLeave', $.store.get('trapLeave') + 1));

    // --- Зона с detect: только .marker, тела игнорируются -----------------
    $('<trigger>', { id: 'detect', detect: '.marker' }).at(500, 100).size(100, 100)
        .appendTo($.world)
        .on('enter', () => $.store.set('detectEnter', $.store.get('detectEnter') + 1));

    $('<rect>', { id: 'marker', class: 'marker' }).at(700, 100).size(30, 30).appendTo($.world);
    $('<enemy>', { id: 'body-in-zone' }).at(500, 100).appendTo($.world);   // тело, но не маркер
    $('<rect>', { id: 'plain-in-zone' }).at(500, 100).size(10, 10).appendTo($.world);

    // --- Стена для .overlaps(sel) и .overlaps(sel, cb) --------------------
    $('<rect>', { id: 'wall-a', class: 'wall' }).at(400, 400).size(40, 40).appendTo($.world);
});
