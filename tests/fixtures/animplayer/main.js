// ===========================================================================
// Фикстура тестов анимационного плеера ($.anim.player).
//
// Поднимает по плееру на каждый сценарий: петля, один проход, кроссфейд двух
// клипов, value-дорожка, кадры спрайт-листа и пустой клип. Результат работы
// складывается в $.store, откуда его читает
// tests/agent/highlevel_animplayer_test.py.
//
// Требует, чтобы api.js поставил подсистему:
//   import { installAnimPlayer, tickAnimPlayer } from './animplayer.js';
//   installAnimPlayer($);        // сразу после installAnim($)
//   tickAnimPlayer(dt);          // сразу после tickAnim(dt)
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // --- Клипы плеера -------------------------------------------------------
    // Петля: позиция, альфа и событие «шаг» на половине клипа.
    $.anim.clip('walk', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } },
                                       { t: 1000, v: { x: 100, y: 40 } }] },
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 0.5 }] },
        ],
        events: [{ at: 500, name: 'step', data: { n: 1 } }],
    });

    // Второй клип для кроссфейда: стоит на месте и держит альфу 0.25.
    $.anim.clip('idle', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } },
                                       { t: 1000, v: { x: 0, y: 0 } }] },
            { type: 'alpha', keys: [{ t: 0, v: 0.25 }, { t: 1000, v: 0.25 }] },
        ],
    });

    // Один проход: поворот на 1.5 рад, стартовое событие и событие на 200 мс.
    $.anim.clip('open', {
        duration: 400,
        tracks: [{ type: 'rotation', keys: [{ t: 0, v: 0 }, { t: 400, v: 1.5 }] }],
        events: [{ at: 0, name: 'boot' }, { at: 200, name: 'half' }],
    });

    // Произвольное значение (пишется и в node.attrs), цвет и событие-пульс.
    $.anim.clip('energy', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'value', name: 'power', attr: true, keys: [{ t: 0, v: 100 }, { t: 1000, v: 0 }] },
            { type: 'color', keys: [{ t: 0, v: '#204060' }, { t: 1000, v: '#ff8040' }] },
        ],
        events: [{ at: 300, name: 'pulse' }],
    });

    // Кадры спрайт-листа: 4 кадра по кругу, 10 к/с.
    $.anim.clip('sheet', {
        duration: 400,
        loop: 'loop',
        tracks: [{ type: 'sprite', fps: 10, from: 0, to: 3 }],
    });

    // Пустой клип: только время, ни одной дорожки.
    $.anim.clip('empty-clip', { duration: 300, loop: 'loop', tracks: [] });

    // --- 1. Петля: цель по селектору и событие ---------------------------------
    $('<rect>', { id: 'hero' }).at(0, 0).size(20, 20).appendTo($.world);
    $.anim.player('hero').target('#hero').play('walk');
    $.anim.player('hero').on('step', () => {
        $.store.set('steps', ($.store.get('steps', 0) || 0) + 1);
    });

    // --- 2. Один проход: конец клипа и события --------------------------------
    $('<rect>', { id: 'door' }).at(200, 100).size(40, 40).appendTo($.world);
    $.anim.player('door').target('#door').play('open');
    $.anim.player('door').on('half', () => { $.store.set('doorHalf', 1); });
    $.anim.player('door').on('finished', () => {
        $.store.set('doorDone', ($.store.get('doorDone', 0) || 0) + 1);
    });

    // --- 3. Кроссфейд двух клипов ---------------------------------------------
    $('<rect>', { id: 'mixer' }).at(300, 100).size(20, 20).appendTo($.world);
    $.anim.player('mixer').target('#mixer').blend('idle', 'walk', 0.5);

    // --- 4. Плеер по умолчанию (фасад $.anim.*) -------------------------------
    $('<rect>', { id: 'ghost' }).at(100, 300).size(20, 20).appendTo($.world);
    $.anim.target('#ghost').play('energy');
    $.anim.on('event', (e) => { $.store.set('lastEvent', e.name); });

    // --- 5. Пустой клип -------------------------------------------------------
    $('<rect>', { id: 'quiet' }).at(0, 300).size(10, 10).appendTo($.world);
    $.anim.player('quiet').target('#quiet').play('empty-clip');

    // --- 6. Дорожка кадров на узле с настоящим листом -------------------------
    // Кадры берём у встроенного белого спрайта: тесту важна смена индекса, а не
    // картинка. Так проверяется и запись node.sprite/node.frame_index.
    const white = $.gfx.white;
    $('<sprite>', { id: 'fx', frames: [white, white, white, white] })
        .at(400, 100).size(24, 24).appendTo($.world);
    $.anim.player('fx').target('#fx').play('sheet');

    $.store.set('steps', 0);
    $.store.set('doorDone', 0);
    $.store.set('doorHalf', 0);
});
