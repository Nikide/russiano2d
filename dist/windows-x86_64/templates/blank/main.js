// {{name}} — пустой проект Russiano2D. Игра = код + данные: здесь код.
$.ready(() => {
    $.gfx.color('#0b0e14');
    $('<text>', { text: 'Привет, Russiano2D!', size: 32 })
        .at(640, 360)
        .appendTo($.world);
});
