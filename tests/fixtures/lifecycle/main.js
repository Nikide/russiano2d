// ===========================================================================
// Фикстура приёмки §5/§13: области владения, restart комнаты и cleanup.
//
// Комната собирается внутри области (`enter($, scope)`): узлы с телами,
// подписки, таймеры, поток и задача принадлежат области. Persistent HUD
// создаётся ВНЕ области и обязан переживать любое число restart.
//
// Результат — $.agent.expose('lifecycle', …); его читает
// tests/agent/lifecycle_numbers_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);
    // Мгновенные переходы: тест крутит restart сотни раз.
    $.scene.transition('fade', 0);

    const st = {
        rooms: 0,            // сколько раз комната вошла
        other: 0,            // сколько раз вошла вторая сцена
        signalHits: 0,
        timerFired: 0,
        flowFired: 0,
        chunks: 0,
        chunkDone: 0,
        loaderWork: 0,
        loaderDone: 0,
        closesFromCallback: 0,
    };
    $.agent.expose('lifecycle', () => st);

    // Persistent HUD: создан вне области владения — его не должна трогать
    // ни одна область, ни clearWorld со `scope`.
    // Класс scene-persistent — явное «владелец другой» и для старого пути
    // clearWorld, и для областей владения.
    $('<text>', { id: 'hud', text: 'HUD', size: 20 }).at(20, 20).appendTo($.world);
    $('#hud').addClass('scene-persistent');

    function buildRoom($, scope) {
        st.rooms++;
        for (let i = 0; i < 6; i++) {
            $('<rect>', { id: 'room-block-' + i }).at(60 + i * 24, 60).size(16, 16)
                .body('static').appendTo($.world);
        }
        // Узел, который закрывает СВОЮ область прямо из обработчика события —
        // та же фаза, что contact callback: разрушение откладывается до
        // безопасной фазы (tickLifecycle), а не идёт посреди callback'а.
        $('<rect>', { id: 'room-closer' }).at(300, 60).size(16, 16).appendTo($.world);
        $('#room-closer').on('hit', () => {
            st.closesFromCallback++;
            scope.close('закрыто из callback');
        });

        $.signal.on('lifecycle:tick', () => { st.signalHits++; });
        scope.after(60000, () => { st.timerFired++; });
        scope.every(60000, () => { st.timerFired++; });
        $.flow.after(60000, () => { st.flowFired++; });
        $.task.chunked({
            total: 1000000,
            budget: 1,
            step: () => { st.chunks++; },
            done: () => { st.chunkDone++; },
        });
    }

    $.scene.add('room', {
        enter($, scope) { buildRoom($, scope); },
    });

    $.scene.add('other', {
        enter() { st.other++; },
    });

    // Стартовая комната — сразу в области владения.
    $.scene.load('room', { transition: 'none', scope: true });
});
