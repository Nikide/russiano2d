// Фикстура теста «то, что обещает справочник, работает».
//
// Здесь живут узлы, на которых проверяются найденные расхождения доков и кода:
// скорость тега (player 250 / enemy 90 / npc 70), событие контакта под именем
// из документации ('collision') и каноническим ('collide'), доступность
// $.pool.tickPool() и $.input.rumble().
$.ready(() => {
    // Счётчики для проверок — игра сама о себе рассказывает.
    $.docsapi = { collision: 0, collide: 0, touched: 0 };

    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 800, 600);
    $('<rect>', { id: 'base' }).at(400, 300).size(800, 600).color('#101820').appendTo($.world);

    $('<player>', { id: 'hero' }).at(100, 300).appendTo($.world);
    $('<enemy>', { id: 'foe' }).at(300, 300).appendTo($.world);
    $('<npc>', { id: 'villager' }).at(500, 300).appendTo($.world);
    $('<rect>', { id: 'box' }).at(600, 300).size(40, 40).appendTo($.world);

    // Один и тот же обработчик подвешен двумя именами: документация пишет
    // 'collision', движок шлёт 'collide' — работать обязаны оба.
    $('#box').on('collision', () => { $.docsapi.collision++; });
    $('#box').on('collide', () => { $.docsapi.collide++; });
    $('#box').on('hit', () => { $.docsapi.touched++; });
});
