// ===========================================================================
// Фикстура тестов API мира (task-68): удаление узлов, clear()/destroy(),
// чтение сетки и $.collision.of(selector).
//
// Мир намеренно перемешан: игровые узлы, вложенный узел, persistent-узлы
// (класс и attrs), интерфейс, стены bounds() и фон. По числам «сколько было /
// сколько стало» тест проверяет контракт, а не только наличие методов.
//
// Ничего не двигается само: телу героя и врагов сразу ставится static, чтобы
// прогон не зависел от гравитации и порядка шагов.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 1280, 720);
    $.world.background('assets/bg.png', { parallax: 0.2 });

    // Слои коллизий — для $.collision.of(): имя ставится до проверки.
    $.collision.define('walls', 0x1).define('enemies', 0x2).define('player', 0x4);

    $('<rect>', { id: 'hero', class: 'hero' })
        .at(100, 300).size(28, 40).body('static').appendTo($.world)
        .layerName('player');

    for (let i = 0; i < 3; i++) {
        $('<enemy>', { id: 'goblin-' + i, class: 'goblin' })
            .at(500 + i * 60, 300).size(28, 40).body('static').appendTo($.world)
            .layerName('enemies');
    }

    $('<rect>', { id: 'crate', class: 'crate' })
        .at(800, 300).size(32, 32).body('static').appendTo($.world);

    // Родитель и ребёнок: удаление родителя уносит и ребёнка — счётчик
    // remove() обязан показать оба узла, а не только выбранный.
    $('<rect>', { id: 'parent', class: 'group' })
        .at(900, 300).size(32, 32).body('static').appendTo($.world);
    $('<rect>', { id: 'child', class: 'group-child' })
        .at(910, 310).size(8, 8).appendTo($('#parent'));

    // Два способа пометить узел постоянным: класс (так делает $.ui.persist) и
    // атрибут (так помечает игра/сохранение). clear() обязан уважать оба.
    $('<rect>', { id: 'persist' })
        .at(1000, 300).size(16, 16).body('static').appendTo($.world)
        .addClass('scene-persistent');
    $('<rect>', { id: 'persist-attr' })
        .at(1040, 300).size(16, 16).body('static').appendTo($.world)
        .attr('persistent', true);

    $('<rect>', { id: 'marker', class: 'prop' })
        .at(20, 20).size(12, 12).appendTo($.world);

    // Интерфейс: clear() по умолчанию его не трогает, destroy() — сносит.
    $('<ui.label>', { id: 'hud', text: 'HP 100' }).at(20, 20).appendTo($.ui);
});
