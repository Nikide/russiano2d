// ===========================================================================
// Фикстура агентского теста $.flow: series/parallel/repeat/after, порядок,
// отмена через область владения (§5) и остановка на паузе $.time.
//
// Результат — $.agent.expose('flow', …) для tests/agent/highlevel_flow_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);
    $('<rect>', { id: 'marker' }).at(40, 40).size(8, 8).appendTo($.world);

    const st = {
        series: 0,
        seriesDone: 0,
        repeats: [],
        afterFired: 0,
        parallel: [],
        parallelDone: 0,
        scopedTicks: 0,
        scopedCancelled: 0,
        pausedFire: 0,
    };
    $.agent.expose('flow', () => st);

    // Серия: задержка → шаг → задержка, затем then.
    $.flow.series([100, () => { st.series++; }, 100]).then(() => { st.seriesDone++; });

    // Повторы с задержкой 0.1 с: ровно три.
    $.flow.repeat(3, (i) => { st.repeats.push(i); return 100; });

    // Параллель: обе ветки завершаются, порядок результатов — по шагам.
    $.flow.parallel([
        () => { st.parallel.push('a'); return 100; },
        () => { st.parallel.push('b'); return 50; },
    ]).then(() => { st.parallelDone++; });

    $.flow.after(50, () => { st.afterFired = 1; });

    // Поток под областью владения: закрытие области его отменяет.
    const scope = $.scene.scope('flow:room');
    const scoped = $.flow.repeat(1000, () => { st.scopedTicks++; return 50; }, { scope });
    scoped.then(() => {}, () => { st.scopedCancelled++; });
});
