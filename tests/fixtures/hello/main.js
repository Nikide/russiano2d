// Проверочная игра (фикстура тестов): маленький мир на высокоуровневом API.
import { installScenes } from './scenes.js';

$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 1280, 720);

    $('<player>', { id: 'hero' })
        .at(100, 300)
        .size(28, 40)
        .health(100)
        .controls('wasd')
        .appendTo($.world);

    for (let i = 0; i < 3; i++) {
        $('<enemy>', { class: 'goblin' })
            .at(500 + i * 60, 300)
            .health(30)
            .appendTo($.world);
    }

    $('<ui.label>', { id: 'hud', text: 'HP 100' }).at(80, 24).appendTo($.ui);
    $('<ui.button>', { id: 'btn' }).at(200, 640).size(160, 44).text('Кнопка').appendTo($.ui);
    $('#btn').on('click', () => { $.emit('btnClick'); });

    $.camera.follow('#hero', { smooth: 0.2 });
    installScenes($);
});

// Публикуем события в state, чтобы агент видел их результат.
$.on('btnClick', () => { $.agent.expose('btnClicks', () => ($.store.get('btnClicks', 0) + 1)); });

$.update(() => {
    $('.goblin').each((i, e) => {
        if (e.distanceTo('#hero') < 300) e.moveTowards('#hero', 40);
        $('#hud').text('HP ' + $('#hero').hp() + ' / врагов ' + $('.goblin').length);
    });
});
