// ===========================================================================
// Фикстура тестов подсистемы анимации ($.anim).
//
// Поднимает по узлу на каждый режим клипа и машину состояний; результат
// работы складывается в $.store, откуда его читает tests/agent/highlevel_anim_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // Клип на один проход: дорожка x, дорожка alpha и событие на половине.
    $.anim.define('slide', {
        duration: 1000,
        loop: 'once',
        tracks: [
            { prop: 'x', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] },
            { prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 0.2 }] },
        ],
        events: [{ at: 0.5, name: 'slideHalf', data: { power: 7 } }],
    });

    // Клип-петля: угол растёт до PI и начинает заново.
    $.anim.define('spin', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ prop: 'angle', keys: [{ t: 0, v: 0 }, { t: 1, v: Math.PI }] }],
    });

    // Клип-пинг-понг: масштаб ходит 1 → 2 → 1.
    $.anim.define('pulse', {
        duration: 1000,
        loop: 'pingpong',
        tracks: [{ prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 2 }] }],
    });

    // Пара клипов для машины состояний.
    $.anim.define('idle-anim', {
        duration: 500,
        loop: 'loop',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] }],
    });
    $.anim.define('walk-anim', {
        duration: 500,
        loop: 'loop',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }] }],
    });

    // --- Один проход и события ---------------------------------------------
    $('<rect>', { id: 'actor' }).at(0, 0).size(20, 20).appendTo($.world);
    $('#actor').playClip('slide');
    $('#actor').on('key', (e) => { $.store.set('lastKey', e.data.name); });
    $('#actor').on('clipEnd', () => {
        $.store.set('slideEnds', ($.store.get('slideEnds', 0) || 0) + 1);
    });

    // --- Петля ---------------------------------------------------------------
    $('<rect>', { id: 'spinner' }).at(80, 80).size(20, 20).appendTo($.world);
    $('#spinner').playClip('spin');

    // --- Пинг-понг -----------------------------------------------------------
    $('<rect>', { id: 'pulsar' }).at(120, 120).size(20, 20).appendTo($.world);
    $('#pulsar').playClip('pulse');

    // --- Машина состояний ----------------------------------------------------
    $('<rect>', { id: 'walker' }).at(40, 40).size(20, 20).appendTo($.world);
    $('#walker').attr('moving', false);
    // Подписка — ДО stateMachine(): начальное состояние входит синхронно
    // (как AnimationTree в Godot), и обработчик, повешенный после, пропустил
    // бы stateEnter для initial.
    $('#walker').on('stateEnter', (e) => { $.store.set('lastState', e.data.state); });
    $('#walker').stateMachine({
        initial: 'idle',
        states: {
            idle: { clip: 'idle-anim' },
            walk: { clip: 'walk-anim' },
        },
        transitions: [
            { from: 'idle', to: 'walk', when: (node) => node.attrs.moving === true },
        ],
    });

    $.store.set('slideEnds', 0);
});
