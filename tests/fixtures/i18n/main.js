// Фикстура интеграционного теста локализации и ввода.
//
// Узлы <ui.label> с attrs.tr переводит tickI18n; выбранный язык лежит в
// $.store. Аналоговой оси геймпада в headless-прогоне нет, поэтому padAxis
// подменяется — так мёртвая зона проверяется детерминированно.
$.ready(() => {
    $.world.color('#101820').bounds(0, 0, 800, 600);

    $.i18n.add('ru', {
        'menu.play': 'Играть',
        'kills': ['{n} штука', '{n} штуки', '{n} штук'],
    });
    $.i18n.add('en', {
        'menu.play': 'Play',
        'kills': ['{n} item', '{n} items'],
    });
    $.i18n.lang('ru');
    $.i18n.auto(true);

    $('<ui.label>', { id: 'title', tr: 'menu.play', size: 24 })
        .at(400, 60).appendTo($.ui);

    // Объектная форма tr: ключ + параметр числа → плюральная форма.
    $('<ui.label>', { id: 'counter', tr: { key: 'kills', n: 3 }, size: 20 })
        .at(400, 100).appendTo($.ui);

    // Привязки действий: тест сохранит и восстановит их через $.store.
    $.input.bind('jump', ['space']);
    $.input.bind('fire', ['mouse.left']);

    // Аналоговая ось для проверки deadzone (в headless геймпада нет).
    $.input.padAxis = () => 0.5;
});
