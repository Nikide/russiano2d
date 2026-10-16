// ===========================================================================
// Фикстура §44: политики обработки, visibility/activation и симуляционные тики.
//
// Сцена собрана так, чтобы каждый пункт приёмки §44 измерялся числами:
//   * <foe>  — тело + контроллер (.controls) + sensor-область: три РАЗНЫЕ
//              вещи; политика update не трогает физику, а areaOn не трогает
//              обработку;
//   * <probe> — тело по инерции: по нему меряется «одинаковое simulation time
//              при 30/60/144 render FPS» (жизнь = 45 тиков);
//   * <doomed> — таймер смерти по тикам (заявленные часы — симуляция);
//   * анимация кадров на <foe> (loop: false) — завершение обязано работать,
//              когда остановлена только movement-логика;
//   * <sleeper> — далеко за кадром, auto-политика выключает обработку, но
//              уборка области §5 обязана его освободить (нет «завис навсегда»).
//
// Читает тест tests/agent/highlevel_activation_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 900).color('#101820').bounds(-400, -400, 3200, 2400);

    $('<wall>', { id: 'ground' }).at(400, 560).size(2400, 40).appendTo($.world);

    // --- Проба для замера симуляционного времени ---------------------------
    // Пуля по инерции: gravity off, скорость 120 px/s, столкновений на пути нет.
    $('<bullet>', { id: 'probe' }).at(200, 300).size(8, 8).velocity(120, 0).appendTo($.world);
    $.store.set('probeGone', -1);
    // Тик рождения: `ready` выполняется ПОСЛЕ шага симуляции этого кадра,
    // поэтому при разном render FPS тело рождается на разном тике. Тест
    // сравнивает состояния относительно рождения, а не абсолютные номера.
    $.store.set('probeBorn', $.time.tick());
    $.store.set('probeX0', 200);
    // Жизнь в тиках, а не в кадрах: 45 шагов симуляции = 0.75 с.
    const probe_life = $.time.duration(45);
    probe_life.onEnd(() => $.store.set('probeGone', $.time.tick()));

    // --- Враг: тело, контроллер и sensor-область ---------------------------
    $('<enemy>', { id: 'foe', speed: 90 }).at(700, 500).size(28, 40)
        .controls('both').appendTo($.world);
    // Область создана выключенной: включается отдельной операцией (.areaOn).
    $('#foe').area('sense', { shape: 'circle', r: 80, sensor: true, enabled: false });

    // Цель внутри области — статичное тело, чтобы не толкать <foe>.
    $('<wall>', { id: 'prey' }).at(730, 500).size(20, 20).appendTo($.world);

    // --- Анимация кадров: завершение при остановленной movement-логике ----
    const white = $.gfx.whiteSprite;
    const foe = $('#foe').get(0);
    foe.frames = [white, white, white, white];
    $('#foe').animate({ from: 0, to: 3, speed: 10, loop: false });
    $.store.set('animEnds', 0);
    $('#foe').on('anim:end', () => $.store.set('animEnds', $.store.get('animEnds') + 1));

    // --- Таймер смерти по симуляционным часам ------------------------------
    $('<enemy>', { id: 'doomed' }).at(900, 500).size(28, 40).appendTo($.world);
    $.time.afterTicks(30, () => {
        const n = $('#doomed');
        if (n.length) n.remove();
    }, { node: $('#doomed').get(0) });

    // --- Скрытый узел: auto-политика + уборка областью §5 ------------------
    $('<enemy>', { id: 'sleeper' }).at(5000, 500).size(28, 40).appendTo($.world);
    $.activation.auto('#sleeper');
    const room = $.scene.scope('activation:test');
    room.node($('#sleeper'));
    // Таймер без владельца-узла: политика узла его не останавливает — уборка
    // не может «зависнуть» из-за выключенной обработки.
    room.after(400, () => {
        const n = $('#sleeper');
        if (n.length) n.remove();
    });
});
