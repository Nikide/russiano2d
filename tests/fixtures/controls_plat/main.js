// ===========================================================================
// Фикстура теста встроенного управления: coyote time, jump buffer, переменная
// высота прыжка, запрет повторного прыжка, спрыгивание с односторонней
// платформы и перенос движущейся платформой.
//
// Уровень — несколько независимых площадок далеко друг от друга: каждый узел
// проверяется сам по себе, а клавиши общие (как в настоящей игре).
// Результаты складываются в $.store, откуда их читает
// tests/agent/highlevel_controls_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 1800).color('#101820').bounds(-400, -800, 7000, 2400);

    // Счётчики для теста: сколько раз узел реально прыгнул.
    $.store.set('jumps', 0);
    $.store.set('liftDir', 1);

    // --- 1. Coyote time ------------------------------------------------------
    // Узкая полка: игрок сбегает с неё вправо и жмёт прыжок уже в воздухе.
    $('<wall>', { id: 'ledge-coyote' }).at(300, 500).size(200, 32).appendTo($.world);
    $('<player>', { id: 'coyote' }).at(330, 440).size(26, 30)
        .health(100).controls({ axis: 'both', coyote: 200 })
        .collision(26, 30).appendTo($.world);

    // Та же полка без coyote: в воздухе прыжок обязан не сработать.
    $('<wall>', { id: 'ledge-nocoyote' }).at(900, 500).size(200, 32).appendTo($.world);
    $('<player>', { id: 'nocoyote' }).at(830, 440).size(26, 30)
        .health(100).controls('both')
        .collision(26, 30).appendTo($.world);

    // --- 2. Jump buffer ------------------------------------------------------
    // Падение с высоты: нажатие за ~100 мс до земли должно сработать при касании.
    $('<wall>', { id: 'floor-buffer' }).at(1500, 700).size(400, 32).appendTo($.world);
    $('<player>', { id: 'buffer' }).at(1400, 300).size(26, 30)
        .health(100).controls({ axis: 'both', jumpBuffer: 200 })
        .collision(26, 30).appendTo($.world);
    // Контроль: то же падение и то же нажатие, но буфера нет.
    $.store.set('shadowY', 0);
    $('<player>', { id: 'nobuffer' }).at(1620, 300).size(26, 30)
        .health(100).controls('both')
        .collision(26, 30).appendTo($.world);

    // --- 3. Переменная высота прыжка ----------------------------------------
    $('<wall>', { id: 'floor-jump' }).at(2500, 760).size(600, 32).appendTo($.world);
    // Обычный прыжок: полная высота, пока кнопку держат. Сила из .attr():
    // раньше она не доходила до string-схемы .controls('both').
    $('<player>', { id: 'tall' }).at(2300, 700).size(26, 30)
        .health(100).controls('both').attr({ jumpForce: 900 })
        .collision(26, 30).appendTo($.world);
    // Тот же прыжок, но отпущенная кнопка режет подъём.
    $('<player>', { id: 'cut' }).at(2700, 700).size(26, 30)
        .health(100).controls({ axis: 'both', jumpCut: 0.35 }).attr({ jumpForce: 900 })
        .collision(26, 30).appendTo($.world);

    // --- 4. Запрет повторного прыжка при зажатой кнопке ----------------------
    $('<wall>', { id: 'floor-hold' }).at(3150, 760).size(400, 32).appendTo($.world);
    $('<player>', { id: 'hold' }).at(3100, 700).size(26, 30)
        .health(100).controls('both')
        .collision(26, 30).appendTo($.world)
        .on('jump', () => $.store.set('jumps', ($.store.get('jumps', 0) || 0) + 1));

    // --- 5. Спрыгивание с односторонней платформы ---------------------------
    // Платформа, под ней — пол: спрыгнувший обязан оказаться между ними.
    $('<wall>', { id: 'oneway-drop' }).at(3600, 500).size(300, 20).appendTo($.world);
    $('#oneway-drop').oneWay(true);
    $('<wall>', { id: 'floor-under-drop' }).at(3600, 900).size(600, 32).appendTo($.world);
    $('<player>', { id: 'dropper' }).at(3600, 440).size(26, 30)
        .health(100).controls('both')
        .collision(26, 30).appendTo($.world);

    // Вторая платформа — для явного вызова .dropThrough() без клавиш.
    // Автоматическое спрыгивание выключено: проверяем именно метод.
    $('<wall>', { id: 'oneway-manual' }).at(4050, 500).size(300, 20).appendTo($.world);
    $('#oneway-manual').oneWay(true);
    $('<wall>', { id: 'floor-under-manual' }).at(4050, 900).size(600, 32).appendTo($.world);
    $('<player>', { id: 'manual' }).at(4050, 440).size(26, 30)
        .health(100).controls({ axis: 'both', dropThrough: false })
        .collision(26, 30).appendTo($.world);

    // --- 6. Перенос движущейся платформой -----------------------------------
    // Трение нарочно низкое (0.02): без переноса игрок остался бы на месте —
    // трение Box2D успело бы сдвинуть его на пару пикселей, не больше.
    // Клавиша прыжка у наездника своя: общие Space из других проверок не должны
    // сбивать его с платформы.
    $('<wall>', { id: 'lift' }).at(4700, 400).size(220, 20)
        .attr({ friction: 0.02 }).body('kinematic').appendTo($.world);
    $('<player>', { id: 'rider' }).at(4700, 340).size(26, 30)
        .health(100).controls({ axis: 'both', jump: 'q', up: 'e' })
        .collision(26, 30).appendTo($.world);

    // --- 7. §8: склон, потолок и внешняя скорость --------------------------
    // Склон 30°: на нём стоят двое — обычный и с лимитом угла 10°. Гравитация
    // выключена, чтобы положение было детерминированным (тест сам кладёт узел
    // на поверхность лучом), а проверялся именно контракт опоры.
    $('<wall>', { id: 'slope-a', friction: 1.0, oneWay: false })
        .at(5300, 600).size(300, 24).angle(-30 * Math.PI / 180).appendTo($.world);
    $('<player>', { id: 'slope-plain' }).at(5300, 500).size(26, 30)
        .health(100).gravity(false).controls('both').attr({ friction: 1.0 })
        .collision(26, 30).appendTo($.world);

    $('<wall>', { id: 'slope-b', friction: 1.0 }).at(5700, 600).size(300, 24)
        .angle(-30 * Math.PI / 180).appendTo($.world);
    $('<player>', { id: 'slope-limit' }).at(5700, 500).size(26, 30)
        .health(100).gravity(false).controls({ axis: 'both', maxSlope: 10 })
        .attr({ friction: 1.0 }).collision(26, 30).appendTo($.world);

    // Потолок: узел с выключенной гравитацией висит вплотную под ним.
    $('<wall>', { id: 'ceiling' }).at(6100, 400).size(240, 24).appendTo($.world);
    $('<player>', { id: 'ceil' }).at(6100, 431).size(26, 30)
        .health(100).gravity(false).controls('both').attr({ friction: 1.0 })
        .collision(26, 30).appendTo($.world);

    // Плоская площадка для проверки внешней скорости (урон/отдача).
    $('<wall>', { id: 'floor-ext' }).at(6500, 600).size(400, 32).appendTo($.world);
    $('<player>', { id: 'ext' }).at(6500, 540).size(26, 30).health(100)
        .controls('both').collision(26, 30).appendTo($.world);

    // Платформа ездит вправо-влево между x = 4500 и 4900. Скорость задаём
    // каждый кадр: кинематическое тело живёт ею, а без обновления оно уехало бы
    // за предел.
    $.update(() => {
        const lift = $('#lift');
        if (!lift.length) return;
        const x = lift.pos().x;
        let dir = $.store.get('liftDir', 1) || 1;
        if (x > 4900) dir = -1;
        else if (x < 4500) dir = 1;
        $.store.set('liftDir', dir);
        lift.velocity(dir * 130, 0);
    });
});
