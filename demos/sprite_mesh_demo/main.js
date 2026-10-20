// Компактная демонстрация полного SpriteMesh pipeline: atlas → cache → обычная анимация.
$.ready(() => {
    $.gfx.color('#101923');
    $.world.gravity(0, 0);
    $.input.bind('idle', ['1']);
    $.input.bind('walk', ['2']);
    $.input.bind('attack', ['3']);
    $.input.bind('mesh', ['m']);
    $.input.bind('rotate', ['r']);

    const sheet = $.atlas.load('witch', 'assets/witch.atlas.json');
    const clips = Object.fromEntries(['idle', 'walk', 'attack'].map(name => [name, sheet.tagSprites(name)]));
    const hero = $('<sprite>', { id: 'sprite-mesh-hero' }).frames(clips.idle).frame(0)
        .at(0, 0).size(192, 192).appendTo($.world);
    hero.spriteMesh(true);
    let clip = 'idle';
    let meshEnabled = true;
    let rotate = false;
    const hud = $.ui.doc('ui/hud.rml').show();
    const play = name => {
        clip = name;
        hero.frames(clips[name]).frame(0).animate({ from: 0, to: clips[name].length - 1,
            speed: 8, loop: name !== 'attack' });
        hud.text('status', `${name.toUpperCase()} · ${clips[name].length} кадров`);
    };
    $.agent.expose('spriteMeshDemo', () => ({ clip, meshEnabled, rotate,
        frame: hero.nodes[0].frame_index,
        meshFrame: hero.nodes[0].sprite_mesh && hero.nodes[0].sprite_mesh.frameMap
            ? hero.nodes[0].sprite_mesh.frameMap[hero.nodes[0].frame_index] : null,
        mesh: !!hero.spriteMesh() }));
    $.update(dt => {
        if ($.input.pressed('idle')) play('idle');
        if ($.input.pressed('walk')) play('walk');
        if ($.input.pressed('attack')) play('attack');
        if ($.input.pressed('mesh')) {
            meshEnabled = !meshEnabled;
            hero.spriteMesh(meshEnabled ? true : false);
        }
        if ($.input.pressed('rotate')) rotate = !rotate;
        if (rotate) hero.rotate(30 * dt);
        hud.text('help', '1 — стойка · 2 — шаг · 3 — атака · M — SpriteMesh · R — вращение');
    });
    play('idle');
});
