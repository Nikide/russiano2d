// ===========================================================================
// Фикстура теста логики и состояний: $.state, $.signal и $.flow.
//
// Всё, что проверяет Python-тест, складывается в $.store (числа и строки) —
// так результат виден агенту без разбора внутренних объектов. Сценарии
// потоков запускаются помощниками из globalThis.flowRun: тест сам решает,
// когда их стартовать, и меряет время кадрами (движок идёт с --fixed-dt).
//
// Машина героя покрывает все ветки подсистемы: guard, action, ловушку '*',
// составное состояние air с подсостояниями up/down, относительную цель,
// историю и хуки. Отдельная машина 'game' живёт без узла — проверяем, что
// и она тикает.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // --- Счётчики, которые читает Python-тест -----------------------------
    const counters = ['idleEnter', 'idleExit', 'runEnter', 'airEnter', 'airExit',
        'downEnter', 'deadEnter', 'moveAction', 'jumps', 'ticks', 'gameTicks',
        'hookAir', 'transitions', 'flowDone', 'afterFired', 'parallelDone',
        'repeatDone', 'score'];
    for (const key of counters) $.store.set(key, 0);
    $.store.set('flowLog', '');
    $.store.set('signalLog', '');

    const bump = (key, by) => $.store.set(key, $.store.get(key) + (by === undefined ? 1 : by));
    const note = (key, text) => $.store.set(key, $.store.get(key) + text);

    // --- Игрок и его машина состояний -------------------------------------
    $('<player>', { id: 'hero' }).at(200, 300).appendTo($.world);

    $.state.create({
        name: 'hero',
        initial: 'idle',
        data: { moving: false },
        states: {
            idle: {
                enter: () => bump('idleEnter'),
                exit: () => bump('idleExit'),
                update: () => bump('ticks'),
                on: {
                    // guard смотрит в data машины: тест включает его вручную.
                    move: {
                        target: 'run',
                        guard: (m) => m.data.moving === true,
                        action: () => bump('moveAction'),
                    },
                    jump: { target: 'air', action: () => bump('jumps') },
                    die: 'dead',
                },
            },
            run: {
                enter: () => bump('runEnter'),
                on: { stop: 'idle', jump: 'air', '*': 'idle' },
            },
            air: {
                initial: 'up',
                enter: () => bump('airEnter'),
                exit: () => bump('airExit'),
                states: {
                    up: { update: () => bump('ticks'), on: { land: 'down' } },
                    down: {
                        enter: () => bump('downEnter'),
                        update: () => bump('ticks'),
                        on: { land: 'idle' },
                    },
                },
            },
            dead: { enter: () => bump('deadEnter') },
        },
    }).attach('#hero');

    const hero = $.state.byName('hero');
    hero.onEnter('air', () => bump('hookAir'));
    hero.onTransition(() => bump('transitions'));

    // Машина игры: узла нет, но tickState обходит и её.
    $.state.create({
        name: 'game',
        initial: 'play',
        states: {
            play: { update: () => bump('gameTicks'), on: { pause: 'paused' } },
            paused: { on: { play: 'play' } },
        },
    });

    // Узел для проверки отвязки машины при удалении.
    $('<rect>', { id: 'ghost' }).at(600, 500).size(20, 20).appendTo($.world);
    $.state.create({
        name: 'ghost',
        initial: 'a',
        states: { a: { on: { go: 'b' } }, b: {} },
        node: '#ghost',
    });

    // --- Сигналы: приоритеты, once, отложенная доставка --------------------
    $.signal.on('score:add', (amount, why) => {
        bump('score', amount);
        note('signalLog', 'score:' + why + ';');
    }, { priority: 10 });
    $.signal.once('score:add', () => note('signalLog', 'once;'));
    $.signal.on('score:add', () => note('signalLog', 'low;'), { priority: -10 });

    $.signal.on('outer', () => {
        note('signalLog', 'outer1;');
        $.signal.emit('inner');          // встанет в очередь
        note('signalLog', 'outer2;');
    });
    $.signal.on('inner', () => note('signalLog', 'inner;'));

    // --- Сценарии потоков, которыми управляет тест -------------------------
    globalThis.flowRun = {
        /** Серия: шаг, пауза ms, шаг. */
        series(ms) {
            $.store.set('flowLog', '');
            $.store.set('flowDone', 0);
            $.flow.series([
                () => note('flowLog', 'a;'),
                ms,
                () => note('flowLog', 'b;'),
            ]).then(() => bump('flowDone'));
            return true;
        },

        /** Две параллельные ветки: 50 и 150 мс. */
        parallel() {
            $.store.set('flowLog', '');
            $.store.set('parallelDone', 0);
            $.flow.parallel([
                $.flow.delay(50).then(() => note('flowLog', 'x;')),
                $.flow.delay(150).then(() => note('flowLog', 'y;')),
            ]).then(() => bump('parallelDone'));
            return true;
        },

        /** Повторы с паузой ms между ними. */
        repeat(times, ms) {
            $.store.set('flowLog', '');
            $.store.set('repeatDone', 0);
            $.flow.repeat(times, (i) => {
                note('flowLog', 'r' + i + ';');
                return ms;
            }).then(() => bump('repeatDone'));
            return true;
        },

        /** Однократный вызов через ms. */
        after(ms) {
            $.store.set('afterFired', 0);
            $.flow.after(ms, () => bump('afterFired'));
            return true;
        },

        /** Заведомо долгий поток: проверяем cancelAll и паузу. */
        pending(ms) {
            $.store.set('flowLog', '');
            $.store.set('flowDone', 0);
            $.flow.series([
                () => note('flowLog', 'start;'),
                ms,
                () => { note('flowLog', 'finish;'); bump('flowDone'); },
            ]);
            return true;
        },
    };
});
