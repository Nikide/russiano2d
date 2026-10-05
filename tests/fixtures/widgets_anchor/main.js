// Фикстура интеграционного теста якорей и тем (widgets_anchor).
//
// Проверяется через агентский протокол: размеры и позиции при разных
// разрешениях окна, пресеты якорей, .rect() от родителя, наследование темы,
// .style() и заблокированный контрол.
$.ready(() => {
    $.world.color('#101820').bounds(0, 0, 800, 600);

    // Тема-зонд и тема-наследник: тест сверяет цвета и размер шрифта.
    $.ui.theme('probe', {
        colors: {
            normal: '#112233', hover: '#223344', pressed: '#334455',
            disabled: '#445566', text: '#eeeeee', fill: '#00ff00',
        },
        size: 22, padding: 10, gap: 6,
    });
    $.ui.theme('probe-child', { extends: 'probe', color: '#334455' });

    // Верхняя полоса во всю ширину: якоря заданы атрибутами.
    $('<ui.panel>', { id: 'topbar', anchorLeft: 0, anchorRight: 1, anchorTop: 0, anchorBottom: 0,
                      offsetTop: 0, offsetBottom: 40 }).appendTo($.ui);

    // Кнопка у правого нижнего угла, 120×40.
    $('<ui.button>', { id: 'br', text: 'OK' }).size(120, 40)
        .anchorPreset('bottom-right').appendTo($.ui);

    // Половина ширины и четверть высоты окна.
    $('<ui.panel>', { id: 'half' }).sizePercent('50%', '25%').appendTo($.ui);

    // Пресет top-left.
    $('<ui.button>', { id: 'tl', text: 'TL' }).size(100, 30)
        .anchorPreset('top-left').appendTo($.ui);

    // .rect() считается от родителя, а не от окна.
    const box = $('<ui.panel>', { id: 'box' }).at(200, 300).size(300, 200).appendTo($.ui);
    $('<ui.button>', { id: 'inner', text: 'in' }).rect(10, 20, 40, 30).appendTo(box);

    // Тема родителя наследуется ребёнком; отдельный узел — тема-наследник.
    const themed = $('<ui.col>', { id: 'themed', gap: 0, padding: 0 }).theme('probe').appendTo($.ui);
    $('<ui.checkbox>', { id: 'kid', text: 'x' }).appendTo(themed);
    $('<ui.slider>', { id: 'sl' }).theme('probe-child').appendTo($.ui);

    // Заблокированный контрол не должен попадать в обход фокуса.
    $('<ui.input>', { id: 'off' }).disabled(true).appendTo($.ui);

    $.store.set('resized', 0);
    $.window.on('resize', () => { $.store.set('resized', $.store.get('resized') + 1); });
});
