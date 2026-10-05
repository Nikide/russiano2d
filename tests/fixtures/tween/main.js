// ===========================================================================
// Фикстура тестов Tween-объектов ($.tween).
//
// Поднимает три сценария — движение с chain, циклы loops(3), callback+method —
// и двух «пустых» узлов, на которых тест сам запускает паузу и kill.
// Результаты складываются в $.store; читает их tests/agent/highlevel_tween_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // Счётчики, которые читает Python-тест.
    $.store.set('moverDone', 0);
    $.store.set('moverSteps', 0);
    $.store.set('loopDone', 0);
    $.store.set('loopCount', 0);
    $.store.set('cbFired', 0);
    $.store.set('methodValue', 0);
    $.store.set('victimDone', 0);

    // --- 1. Движение + параллельное свойство + chain ----------------------
    // Шаг 1: x 0→100 и alpha 1→0.5 за 1 с (параллельно).
    // Шаг 2: y 0→40 за 0.5 с (стартует после первого).
    $('<rect>', { id: 'mover' }).at(0, 0).size(20, 20).appendTo($.world);
    const mover = $.tween($('#mover'));
    mover.property('x', 100, 1);
    mover.property('alpha', 0.5, 1);
    mover.chain().property('y', 40, 0.5);
    mover.on('step', () => { $.store.set('moverSteps', $.store.get('moverSteps') + 1); });
    mover.on('finished', () => { $.store.set('moverDone', $.store.get('moverDone') + 1); });
    $.store.set('moverTween', mover);

    // --- 2. loops(3): x 0→50 за 0.5 с, три прохода ------------------------
    $('<rect>', { id: 'looper' }).at(0, 200).size(20, 20).appendTo($.world);
    const looper = $.tween($('#looper'));
    looper.property('x', 50, 0.5);
    looper.loops(3);
    looper.on('loop', () => { $.store.set('loopCount', $.store.get('loopCount') + 1); });
    looper.on('finished', () => { $.store.set('loopDone', $.store.get('loopDone') + 1); });
    $.store.set('looperTween', looper);

    // --- 3. callback и method --------------------------------------------
    $('<rect>', { id: 'cbnode' }).at(0, 400).size(20, 20).appendTo($.world);
    const cb = $.tween($('#cbnode'));
    cb.callback(() => { $.store.set('cbFired', $.store.get('cbFired') + 1); });
    cb.method((value) => { $.store.set('methodValue', value); }, 0, 10, 1);
    $.store.set('cbTween', cb);

    // --- 4. Заготовки: сценарии запускает сам Python-тест ----------------
    $('<rect>', { id: 'pauser' }).at(0, 0).size(20, 20).appendTo($.world);
    $('<rect>', { id: 'victim' }).at(0, 0).size(20, 20).appendTo($.world);
});
