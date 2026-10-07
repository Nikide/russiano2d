// Фикстура тестов катсцен (tests/agent/highlevel_cutscene_test.py).
//
// Уровень как в игре: управляемый игрок и NPC, за которым следит камера.
// Катсцена должна забрать управление у игрока, провести NPC, подвинуть камеру
// и вернуть всё как было — не перезагружая мир.
$.ready(() => {
    $.world.gravity(0, 0).color('#000000').bounds(0, 0, 2000, 600);
    $('<player>', { id: 'hero', w: 20, h: 28 }).at(100, 300).appendTo($.world);
    $('<npc>', { id: 'npc', w: 20, h: 28 }).at(600, 300).appendTo($.world);
    $('#hero').controls({ axis: 'both', jump: 'space' });
    $.camera.follow('#hero');
});
