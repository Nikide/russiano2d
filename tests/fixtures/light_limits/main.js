// Фикстура §20: лимиты качества света, маски препятствий, неосвещённые узлы
// и динамический occluder. Сцены переключаются из теста: lightScene(name).
//
// Камера в (400,300), зум 1 — мировые координаты совпадают с экранными, и
// яркость точки на кадре читается напрямую. Фон чёрный: свет только добавляет.
const LIGHT_SCENES = ['budget', 'mask', 'unlit', 'dynamic', 'far', 'material'];

$.ready(() => {
    $.camera.at(400, 300).zoom(1);
    $.world.gravity(0, 0).color('#000000');
    $.gfx.light.occluders([]);

    const scenes = {};
    for (const name of LIGHT_SCENES) scenes[name] = [];
    const black = $('<rect>', { id: 'base', x: 400, y: 300, w: 800, h: 600, color: '#000000' })
        .appendTo($.world);
    scenes.budget.push(black);
    scenes.mask.push(black);
    scenes.unlit.push(black);
    scenes.dynamic.push(black);
    scenes.far.push(black);

    // --- budget: три источника с тенями в одном кадре ------------------------
    for (const [i, x] of [[0, 150], [1, 400], [2, 650]]) {
        scenes.budget.push(
            $('<light>', { id: 'b_lamp' + i, radius: 160, intensity: 1, color: '#ffffff',
                           shadows: true, segments: 24 })
                .at(x, 300).blend('add').appendTo($.world));
    }

    // --- mask: маска препятствий у источника ---------------------------------
    scenes.mask.push(
        $('<light>', { id: 'm_lamp', radius: 400, intensity: 1, color: '#ffffff',
                       shadows: true, segments: 48 })
            .at(200, 300).blend('add').appendTo($.world),
        $('<rect>', { id: 'm_wall', x: 300, y: 300, w: 40, h: 40, color: '#2a2f3a' })
            .appendTo($.world));

    // --- unlit: узел вне мирового света --------------------------------------
    // Оба узла на одном расстоянии от фонаря: обычный светится, `.lit(false)`
    // — нет; темнота гасит обычный и не трогает неосвещённый.
    scenes.unlit.push(
        $('<rect>', { id: 'u_lit', x: 400, y: 120, w: 120, h: 80, color: '#808080' })
            .appendTo($.world),
        $('<rect>', { id: 'u_unlit', x: 400, y: 480, w: 120, h: 80, color: '#808080' })
            .lit(false).appendTo($.world),
        $('<light>', { id: 'u_lamp', radius: 260, intensity: 1, color: '#ffffff' })
            .at(400, 300).blend('add').hide().appendTo($.world));

    // --- dynamic: свои препятствия узла (двигающийся ящик) -------------------
    scenes.dynamic.push(
        $('<light>', { id: 'd_lamp', radius: 400, intensity: 1, color: '#ffffff',
                       shadows: true, segments: 48 })
            .at(200, 300).blend('add').appendTo($.world),
        // Локальные координаты: прямоугольник вокруг центра узла. Пока ящик
        // скрыт, он свет не заслоняет — это и есть динамический occluder.
        $('<rect>', { id: 'd_crate', x: 300, y: 300, w: 40, h: 60, color: '#2a2f3a' })
            .occluders([{ x: -20, y: -30, w: 40, h: 60 }]).hide().appendTo($.world));

    // --- material: материалы спрайтов (§20.2) --------------------------------
    // mat_plain — обычный узел, mat_flat — материал без normal-карты (обязан
    // выглядеть так же), mat_norm — материал с normal-картой (пока та же
    // нейтральная норма), mat_glow — emissive и lit:false, mat_tint — tint.
    scenes.material.push(
        $('<rect>', { id: 'mat_plain', x: 250, y: 200, w: 100, h: 100, color: '#808080' })
            .appendTo($.world),
        $('<rect>', { id: 'mat_flat', x: 400, y: 200, w: 100, h: 100, color: '#808080' })
            .material({ lit: true, response: { diffuse: 1, ambient: 0.35 } }).appendTo($.world),
        $('<rect>', { id: 'mat_norm', x: 550, y: 200, w: 100, h: 100, color: '#808080' })
            .material({ normal: 'assets/flat_n.png' }).appendTo($.world),
        $('<rect>', { id: 'mat_glow', x: 250, y: 450, w: 100, h: 100, color: '#202020' })
            .material({ emissive: '#ff8844', emissiveStrength: 1, lit: false }).appendTo($.world),
        $('<rect>', { id: 'mat_tint', x: 400, y: 450, w: 100, h: 100, color: '#ffffff' })
            .material({ tint: '#804020' }).appendTo($.world));

    // --- far: два далёких источника для инвалидации по области ---------------
    scenes.far.push(
        $('<light>', { id: 'f_a', radius: 120, intensity: 1, color: '#ffffff', shadows: true })
            .at(150, 300).blend('add').appendTo($.world),
        $('<light>', { id: 'f_b', radius: 120, intensity: 1, color: '#ffffff', shadows: true })
            .at(700, 300).blend('add').appendTo($.world));

    const all = [];
    for (const name of LIGHT_SCENES) for (const w of scenes[name]) all.push([name, w]);

    function show(name) {
        for (const [scene, w] of all) {
            if (scene === name) w.show();
            else w.hide();
        }
    }

    // Материалы §20.2 регистрируются один раз, до переключения сцен.
    $.gfx.material('glow', { emissive: '#ff8844', emissiveStrength: 1, lit: false });
    $.gfx.material('metal', { albedo: 'assets/metal.png', normal: 'assets/metal_n.png',
                              normalConvention: 'opengl', response: { diffuse: 1, ambient: 0.2 } });

    globalThis.lightScene = (name) => {
        show(name);
        $.gfx.light.ambient.off();
        $.camera.at(400, 300).zoom(1);
        if (name === 'mask') {
            $('#m_lamp').occluderMask(0);
            $.gfx.light.occluders([{ x: 280, y: 280, w: 40, h: 40, mask: 1 }]);
        } else if (name === 'dynamic') {
            $('#d_crate').hide();
            $.gfx.light.occluders([]);
        } else if (name === 'far') {
            $.gfx.light.occluders([]);
        } else {
            $.gfx.light.occluders([]);
        }
        return LIGHT_SCENES.indexOf(name);
    };
    globalThis.lightScenes = () => LIGHT_SCENES.slice();

    lightScene('budget');
});
