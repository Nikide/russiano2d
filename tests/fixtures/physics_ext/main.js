// ===========================================================================
// Фикстура теста физики: формы тел, односторонняя платформа, события
// контакта и суставы.
//
// Результаты складываются в $.store, откуда их читает
// tests/agent/highlevel_physics_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(-500, -500, 2000, 2000);

    // --- 1. Круг как настоящая форма и события контакта ---------------------
    $.store.set('landed', 0);
    $.store.set('separated', 0);
    $.store.set('hitSpeed', 0);

    $('<wall>', { id: 'ground' }).at(200, 400).size(400, 32).appendTo($.world);

    $('<circle>', { id: 'ball' })
        .at(200, 200).size(24, 24)
        .collisionCircle(12)
        .body('dynamic')
        .appendTo($.world);

    $('#ball').on('collide', () => {
        $.store.set('landed', ($.store.get('landed', 0) || 0) + 1);
    });
    $('#ball').on('separate', () => {
        $.store.set('separated', ($.store.get('separated', 0) || 0) + 1);
    });
    $('#ball').on('hit', (e) => {
        $.store.set('hitSpeed', Math.max($.store.get('hitSpeed', 0) || 0, e.data.speed || 0));
    });

    // --- 2. Односторонняя платформа -----------------------------------------
    // Платформа на y = 600; мяч стартует снизу и летит вверх: он должен
    // пройти сквозь, а потом лечь СВЕРХУ.
    $('<wall>', { id: 'oneway' }).at(600, 600).size(300, 20).appendTo($.world);
    $('#oneway').oneWay(true);

    $('<circle>', { id: 'jumper' })
        .at(600, 700).size(20, 20)
        .collisionCircle(10)
        .body('dynamic')
        .velocity(0, -700)
        .appendTo($.world);

    $.store.set('throughUp', false);

    // --- 3. Капсула и полигон ------------------------------------------------
    $('<rect>', { id: 'capsule' })
        .at(900, 200).size(24, 64)
        .body('dynamic')
        .appendTo($.world);
    $('#capsule').shape('capsule', 12);

    // --- 4. Сустав ------------------------------------------------------------
    $('<rect>', { id: 'anchor' }).at(1200, 200).size(20, 20).body('static').appendTo($.world);
    $('<rect>', { id: 'pendulum' }).at(1200, 280).size(24, 24).body('dynamic').appendTo($.world);

    const joint = $('#anchor').joint('#pendulum', { type: 'revolute' });
    $.store.set('jointId', joint);
    $.store.set('jointCount', $.world.jointCount());

    // Дистанционный сустав между двумя телами: стержень длиной ~120.
    $('<rect>', { id: 'bar1' }).at(1500, 200).size(20, 20).body('dynamic').appendTo($.world);
    $('<rect>', { id: 'bar2' }).at(1500, 320).size(20, 20).body('dynamic').appendTo($.world);
    $.store.set('distJoint', $.world.joint('#bar1', '#bar2', { type: 'distance' }));

    // --- 5. Луч и сенсоры ----------------------------------------------------
    // Сенсор (зона-триггер) не препятствие: луч обязан пройти сквозь него,
    // но упереться в настоящую стену за ним. Сами лучи пускаем в $.update:
    // до первого шага мира broadphase Box2D ещё не построен.
    $('<rect>', { id: 'sensor-zone' }).at(1800, 300).size(80, 80)
        .body('static').appendTo($.world);
    $('#sensor-zone').sensor(true);
    $('<wall>', { id: 'ray-wall' }).at(1800, 600).size(200, 40).appendTo($.world);
});

let rays_checked = false;

// Луч сквозь сенсор и луч в стену за ним — после первого шага мира.
$.update(() => {
    if (rays_checked) return;
    rays_checked = true;

    const blocked = $.world.raycast({ x: 1800, y: 100 }, { x: 1800, y: 400 });
    $.store.set('sensorBlocksRay', !!blocked);

    const wall = $.world.raycast({ x: 1800, y: 100 }, { x: 1800, y: 700 });
    $.store.set('rayHitIsWall', !!(wall && wall.node && wall.node.id === 'ray-wall'));
    $.store.set('rayHitY', wall && wall.point ? Math.round(wall.point.y) : -1);
});

// Отмечаем момент, когда прыгун оказался выше платформы.
$.update(() => {
    if ($.store.get('throughUp')) return;
    if ($('#jumper').pos().y < 580) $.store.set('throughUp', true);
});
