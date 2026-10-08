// Фикстура билбордов Re2D с маскотами Re2DSprite — фаза 5 docs/RE2D.md.
//
// Комната без текстур (чтобы пиксели персонажей легко отличались от фона) и три
// NPC — Руся в трёх костюмах из одного описания demos/rotsprite/russi.character.json,
// в pixel-стиле: синтез его картинки около 1 мс против 11 мс у anime.
// Игрок — Re2D-узел, камеру тест двигает сам.
const CHARACTER = 'demos/rotsprite/russi.character.json';

$.ready(() => {
    $.world.gravity(0, 0).color('#000000');
    $.camera.kind(Re2D).eye(48).fov(70).fog(0);
    $.re2d.room({
        x: 0, y: 0, w: 1024, h: 1024, height: 256, tile: 128,
        wallColor: '#303848', floorColor: '#283020', ceilingColor: '#202428',
    });
    const spawn = (id, x, y, costume, facing) => {
        const npc = $.re2dSprite.from(CHARACTER, { id })
            .re2dStyle('pixel').re2dVariant('costume', costume).re2dMotion('idle')
            .at(x, y).size(150, 150).kind(Re2D);
        npc.get(0).angle = facing;
        return npc;
    };
    spawn('maid', 380, 500, 'maid', Math.PI / 2);      // смотрит на юг, к игроку
    spawn('swim', 640, 380, 'swim', Math.PI / 2);
    spawn('police', 900, 500, 'police', Math.PI / 2);
    $('<player>', { id: 'hero' }).at(640, 900).size(32, 32).kind(Re2D).appendTo($.world);
    $.camera.follow('#hero').yaw(-90);
});

$.agent.expose('room', () => $.re2d.info());
