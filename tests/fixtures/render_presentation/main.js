// Фикстура контракта презентации (§18): эталонные сцены для пиксельных
// проверок порядка проходов. Внешних ассетов нет — только <rect>, <player>,
// <wall> и ui-узлы, поэтому проверки не зависят от картинок.
//
// Сцены переключаются из теста: `presentationScene('blend')` и т.п.
// Камера ставится в (400, 300) с зумом 1, поэтому при окне 800×600 мировые
// координаты узлов совпадают с экранными и ожидаемые цвета считаются на бумаге.

const SCENE_LIST = ['blend', 'ysort', 'ui', 'single', 'parallax', 'logic'];

$.ready(() => {
    $.world.color('#000000').gravity(0, 0);
    $.camera.at(400, 300).zoom(1);

    const scenes = {};
    for (const name of SCENE_LIST) scenes[name] = [];

    // --- blend: alpha → add → multiply в порядке создания --------------------
    // В месте пересечения всех трёх квадратов цвет считается по формулам:
    //   чёрный → alpha(#804020) → add(#102010) → multiply(#808080).
    // Ожидание: alpha-only (128,64,32), alpha+add (144,96,48),
    // все три ≈ (72,48,24).
    scenes.blend.push(
        $('<rect>', { id: 'b_alpha', x: 380, y: 300, w: 200, h: 200, color: '#804020' })
            .blend('alpha').layer(0).depth(0).appendTo($.world),
        $('<rect>', { id: 'b_add', x: 440, y: 300, w: 200, h: 200, color: '#102010' })
            .blend('add').layer(0).depth(0).appendTo($.world),
        $('<rect>', { id: 'b_mul', x: 500, y: 300, w: 200, h: 200, color: '#808080' })
            .blend('multiply').layer(0).depth(0).appendTo($.world),
    );

    // Та же геометрия одним режимом: сравнение числа draw calls со сценой выше.
    scenes.single.push(
        $('<rect>', { id: 's_a', x: 380, y: 300, w: 200, h: 200, color: '#804020' })
            .blend('alpha').layer(0).depth(0).appendTo($.world),
        $('<rect>', { id: 's_b', x: 440, y: 300, w: 200, h: 200, color: '#102010' })
            .blend('alpha').layer(0).depth(0).appendTo($.world),
        $('<rect>', { id: 's_c', x: 500, y: 300, w: 200, h: 200, color: '#808080' })
            .blend('alpha').layer(0).depth(0).appendTo($.world),
    );

    // --- ysort: порядок по Y, а не по созданию --------------------------------
    // Верхний (y=260) создан ВТОРЫМ: при сортировке по Y он должен оказаться
    // НИЖЕ красного (y=340) в месте пересечения.
    scenes.ysort.push(
        $('<rect>', { id: 'y_low', x: 400, y: 340, w: 200, h: 120, color: '#cc2020' })
            .layer(0).appendTo($.world),
        $('<rect>', { id: 'y_high', x: 400, y: 260, w: 200, h: 120, color: '#2040cc' })
            .layer(0).appendTo($.world),
    );

    // --- ui: интерфейс поверх сцены и вне мирового света ----------------------
    scenes.ui.push(
        $('<rect>', { id: 'u_world', x: 400, y: 300, w: 400, h: 300, color: '#ffcc00' })
            .layer(0).appendTo($.world),
        $('<ui.panel>', { id: 'u_panel', x: 400, y: 300, w: 200, h: 120, color: '#123456' })
            .appendTo($.ui),
    );

    // --- parallax: слой со своим фактором ------------------------------------
    // Квадрат стоит в мире на (400, 300); при parallax 0.5 сдвиг камеры на
    // +100 сдвигает его по экрану на -50.
    scenes.parallax.push(
        $('<rect>', { id: 'p_slow', x: 400, y: 300, w: 80, h: 80, color: '#22ff88' })
            .parallax(0.5).layer(0).appendTo($.world),
    );

    // --- logic: смена слоя не меняет логику ----------------------------------
    // Динамическое тело над стеной. Тест прогоняет один и тот же сценарий два
    // раза с разными layer/depth и сравнивает позиции, тела и контакты.
    scenes.logic.push(
        $('<wall>', { id: 'l_floor', x: 400, y: 500, w: 600, h: 40 })
            .layer(0).appendTo($.world),
        $('<player>', { id: 'l_hero', x: 400, y: 200, w: 24, h: 24 })
            .layer(0).appendTo($.world),
    );

    const all = [];
    for (const name of SCENE_LIST) for (const w of scenes[name]) all.push([name, w]);

    function show(name) {
        for (const [scene, w] of all) {
            if (scene === name) w.show();
            else w.hide();
        }
    }

    function resetLogic() {
        const hero = $('#l_hero');
        hero.at(400, 200).velocity(0, 0);
        $('#l_floor').at(400, 500);
        return { x: hero.get(0).x, y: hero.get(0).y };
    }

    // Геометрия эталонных сцен: тест может её менять (снаппинг, порядок Y),
    // поэтому при переключении сцены она восстанавливается.
    function resetGeometry(name) {
        if (name === 'blend') {
            $('#b_alpha').size(200, 200).at(380, 300);
            $('#b_add').size(200, 200).at(440, 300);
            $('#b_mul').size(200, 200).at(500, 300);
        } else if (name === 'ysort') {
            $('#y_low').at(400, 340);
            $('#y_high').at(400, 260);
        } else if (name === 'parallax') {
            $('#p_slow').at(400, 300);
        }
    }

    // Публичная точка входа для теста: переключить сцену и сбросить камеру.
    globalThis.presentationScene = (name) => {
        show(name);
        resetGeometry(name);
        if (name === 'blend' || name === 'single') $.gfx.snap(false);
        if (name === 'logic') {
            $.world.sort('layer').gravity(0, 1200);
            resetLogic();
        } else {
            $.world.sort(name === 'ysort' ? 'y' : 'layer').gravity(0, 0);
            if (name === 'parallax') $('#p_slow').parallax(0.5);
        }
        $.camera.at(400, 300).zoom(1);
        $.gfx.light.ambient.off();
        return SCENE_LIST.indexOf(name);
    };
    globalThis.presentationResetLogic = resetLogic;
    globalThis.presentationScenes = () => SCENE_LIST.slice();

    presentationScene('blend');
});
