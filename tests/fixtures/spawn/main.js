// Фикстура: два видимых узла, созданных в ready (без eval со стороны агента).
$.ready(() => {
    $('<player>', { id: 'hero' }).at(100, 300).appendTo($.world);
    $('<rect>', { id: 'box' }).at(0, 0).size(10, 10).appendTo($.world);
});
