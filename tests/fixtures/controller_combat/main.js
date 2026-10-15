// ===========================================================================
// Фикстура §9: общий damage contract — роли форм, атаки, дедупликация,
// причины отказа, отражение, физическая отдача.
//
// Проверяется tests/agent/highlevel_combat_contract_test.py. Гравитация нулевая:
// геометрия должна быть детерминированной, а не «успел ли упасть».
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(-400, -400, 2400, 1200);

    // --- Атакующий: movement collider + hitbox 'blade' ----------------------
    $('<player>', { id: 'hero' }).at(200, 200).size(32, 32)
        .health(100).team(1).body('dynamic').collision(32, 32).appendTo($.world);
    $('#hero').hitbox('blade', { w: 60, h: 20, x: 30 });
    $('#hero').areaOn('blade', true);

    // --- Цель с ДВУМЯ hurtbox: один gameplay-hit, не два --------------------
    $('<rect>', { id: 'dummy' }).at(250, 200).size(32, 32)
        .health(100).team(2).body('static').collision(32, 32).appendTo($.world);
    $('#dummy').hurtbox('torso', { w: 40, h: 40 });
    $('#dummy').hurtbox('head', { w: 20, h: 20, y: -18 });

    // --- Союзник: своя команда ---------------------------------------------
    $('<rect>', { id: 'ally' }).at(400, 200).size(32, 32)
        .health(100).team(1).body('static').collision(32, 32).appendTo($.world);

    // --- Неуязвимый: iframes, но движение обязано работать -----------------
    $('<rect>', { id: 'ghost' }).at(600, 200).size(32, 32)
        .health(100).team(2).body('dynamic').collision(32, 32).appendTo($.world);
    $('#ghost').invulnerable(10000);

    // --- Мёртвая цель -------------------------------------------------------
    $('<rect>', { id: 'corpse' }).at(800, 200).size(32, 32)
        .health(0).team(2).body('static').collision(32, 32).appendTo($.world);

    // --- Отдача под управлением: импульс урона не должен стираться ---------
    $('<player>', { id: 'knockee' }).at(1000, 200).size(32, 32)
        .health(100).team(2).controls('both').body('dynamic').collision(32, 32)
        .appendTo($.world);
});
