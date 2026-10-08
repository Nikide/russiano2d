// Фикстура камеры Re2D — фаза 3 docs/RE2D.md.
//
// Герой — Re2D-узел, камера смотрит его глазами; взгляд мышью включён с
// крупной чувствительностью, чтобы сдвиг в пикселях был заметен в тесте.
// Узлы без kind (`flat`) под камерой Re2D не рисуются, но остаются в мире.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820');
    $('<npc>', { id: 'hero' }).at(640, 640).kind(Re2D).appendTo($.world);
    $('<npc>', { id: 'friend' }).at(740, 640).size(40, 80).kind(Re2D).appendTo($.world);
    $('<rect>', { id: 'flat' }).at(500, 500).appendTo($.world);
    $.camera.kind(Re2D).eye(48).fov(70).follow('#hero');
    $.camera.mouseLook({ on: true, sensitivity: 0.01 });
});

$.agent.expose('view', () => $.camera.info());
