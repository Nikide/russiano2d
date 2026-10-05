// Мини-фикстура без текста: проверяет, что дело не в самом цикле кадров.
$.ready(() => {
    $.world.gravity(0, 1200).bounds(0, 0, 1280, 720);
    $('<player>', { id: 'hero' }).at(100, 300).controls('wasd').appendTo($.world);
});
