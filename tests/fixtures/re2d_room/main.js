// Фикстура мира-коробки Re2D — фаза 4 docs/RE2D.md.
//
// Комната 1024×1024 высотой 256: красные стены, синий пол, зелёный потолок —
// без текстур и тумана, чтобы цвет пикселя был ровно цветом поверхности. Игрок
// стоит у южной стены. Режим текстур включается из теста: globalThis.__textured.
$.ready(() => {
    $.world.gravity(0, 0).color('#000000');
    $.camera.kind(Re2D).eye(48).fov(70).fog(0);
    $.re2d.room({
        x: 0, y: 0, w: 1024, h: 1024, height: 256, tile: 128,
        wallColor: '#c04040', floorColor: '#3050c0', ceilingColor: '#40a040',
    });
    $('<player>', { id: 'hero' }).at(512, 800).size(32, 32).collision(28, 28).kind(Re2D).appendTo($.world);
    $.camera.follow('#hero').yaw(-90);
});

$.agent.expose('room', () => $.re2d.info());
