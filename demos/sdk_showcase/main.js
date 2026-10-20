// Orbital Garden: один SDK project с двумя классическими 2D сценами и Re2D World.
const scene = $.startScene || 'garden';

function setup2d(workshop) {
    $.gfx.color(workshop ? '#101928' : '#09141e');
    $.world.gravity(0, 0).bounds(0, 0, 1280, 768);
    const bindings = $.fs.readJSON('assets/controls.input.json');
    for (const action of Object.keys(bindings.actions)) $.input.bind(action, bindings.actions[action]);
    $.input.deadzone(bindings.deadzone);
    const fonts = $.fs.readJSON('assets/ui.fonts.json');
    for (const font of fonts.fonts) $.font.load(font.name, font.path);
    for (const name of Object.keys(fonts.styles)) $.font.define(name, fonts.styles[name]);
    const level = $.fs.readJSON('level.tilemap.json');
    const map = $('<tilemap>', level).at(640, 384).appendTo($.world);
    map.collisions(true);
    const atlas = $.atlas.load('botanist', 'assets/botanist.atlas.json');
    const idle = atlas.tagSprites('idle');
    const hero = $('<sprite>', { id: 'hero' }).frames(idle).at(workshop ? 640 : 420, 384)
        .size(68, 100).appendTo($.world);
    const collision = $.fs.readJSON('assets/props.collision.json');
    for (const shape of collision.shapes) {
        const node = $('<' + shape.tag + '>', { id: shape.name }).at(shape.x, shape.y);
        if (shape.shape === 'box') node.size(shape.w, shape.h);
        if (shape.shape === 'circle') node.size(shape.radius * 2, shape.radius * 2);
        node.appendTo($.world);
    }
    const fxData = $.fs.readJSON('assets/particles.particles.json');
    const scanFx = $('<particles>', fxData).at(640, 320).appendTo($.world);
    const mix = $.fs.readJSON('assets/sounds.audio.json');
    for (const name of Object.keys(mix.buses)) $.audio.bus(name, mix.buses[name]);
    for (const zone of mix.zones) $.audio.zone(zone.name, zone);
    $.camera.follow('#hero', { smooth: 0.12 }).limits(0, 0, 1280, 768);
    const parallax = $.fs.readJSON('assets/parallax.layers.json');
    let bgReady = false;
    let frames = 0;
    const buildBackground = () => {
        for (const spec of parallax.layers) {
            const layer = $.layers.create(spec);
            for (const item of spec.sprites || []) {
                $('<sprite>', { src: item.src }).at(item.x, item.y).size(item.w, item.h).appendTo(layer);
            }
        }
        bgReady = true;
    };
    const ui = $.ui.doc('ui/hud.rml').show();
    const scan = () => {
        scanFx.burst(24);
        const sound = mix.sounds.scan;
        $.audio.play('assets/' + sound.path, { bus: sound.bus, volume: sound.volume });
        ui.text('status', 'Сканирование завершено · данные сохранены');
    };
    ui.on('scan', 'click', scan);
    ui.on('replay', 'click', () => $.story.play('story/intro.scene'));
    $.agent.expose('showcase', () => ({
        mode: workshop ? 'workshop-2d' : 'garden-2d', hero: { x: hero.x, y: hero.y },
        tiles: { width: level.layers[0].data[0].length, height: level.layers[0].data.length },
        atlas: atlas.frames(), particleCount: scanFx.count(), parallaxReady: bgReady,
        bindings: $.input.bindings(),
    }));
    $.update((dt) => {
        if (!bgReady && ++frames >= 3) buildBackground();
        const move = $.input.vec('wasd');
        hero.move(move.x * 180 * dt, move.y * 180 * dt);
        if ($.input.pressed('scan')) scan();
        if ($.input.pressed('replay_intro')) $.story.play('story/intro.scene');
        if ($.input.pressed('escape')) $.quit();
        ui.text('coords', Math.round(hero.x) + ' / ' + Math.round(hero.y));
    });
}

function setupRe2d() {
    $.gfx.color('#07111c');
    $.world.gravity(0, 0);
    const world = $.re2dWorld.load('maps/orbital_garden.re2dworld').backend('gpu');
    world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: 0.001 });
    world.light({ x: 45, y: 50, h: 50, radius: 115, intensity: 1.5, color: '#78f0cf', shadow: true });
    world.light({ x: 155, y: 50, h: 44, radius: 100, intensity: 1.2, color: '#ffc978', shadow: true });
    const view = { x: 45, y: 50, h: 48, yaw: 0, pitch: 0, fov: 70, near: 1 };
    const ui = $.ui.doc('ui/hud.rml').show();
    ui.text('status', 'Re2D World · авторская карта + runtime renderer');
    $.agent.expose('showcase', () => ({ mode: 're2d', info: world.info(), metadata: world.metadata(), spawns: world.spawns() }));
    $.update((dt) => {
        const move = $.input.vec('wasd');
        view.x += move.x * 34 * dt;
        view.y += move.y * 34 * dt;
        view.yaw += $.input.axis('left', 'right') * 25 * dt;
        if ($.input.pressed('escape')) $.quit();
    });
    $.render(() => world.render(view, 640, 480));
}

$.ready(() => {
    $.dialog.themeDefine('dialog', { rml: 'ui/dialog/dialog.rml', rcss: 'ui/dialog/dialog.rcss', choiceSlots: 6 });
    $.dialog.theme('dialog');
    if (scene === 're2d') setupRe2d();
    else setup2d(scene === 'workshop');
});
