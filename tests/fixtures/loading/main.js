// ===========================================================================
// Фикстура тестов загрузки (§45): сцены, тяжёлый PNG, прогресс и отмена.
//
// Наблюдения складываются в globalThis.S — их читает
// tests/agent/highlevel_loading_test.py. Игра сама решает, блокирует ли загрузка
// игровые часы: здесь на время загрузки вызывается $.time.pause(), поэтому
// таймер прохождения не считает время загрузки (§44 — политика игры).
// ===========================================================================

$.ready(() => {
    const S = globalThis.S = {
        entered: null,        // какая сцена вошла последней
        enter_count: 0,
        frames: 0,            // «анимация»: кадр живёт — счётчик растёт
        steps_done: 0,
        last_step_frame: 0,
        paused: false,
    };

    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 640, 360);

    $.scene.add('menu', { enter() { S.entered = 'menu'; S.enter_count++; } });
    $.scene.add('level', { enter() { S.entered = 'level'; S.enter_count++; } });
    $.scene.add('other', { enter() { S.entered = 'other'; S.enter_count++; } });
    $.scene.load('menu', { transition: 'none' });

    // Кадр-«анимация»: тест по нему видит, что экран загрузки не встал.
    $.update(() => {
        S.frames++;
        if ($.loading && $.loading.visible && $.loading.visible()) S.last_step_frame = S.frames;
    });

    const HEAVY = 'tests/fixtures/loading/assets/heavy.png';
    const HEAVY2 = 'tests/fixtures/loading/assets/heavy2.png';

    /** Ресурсы уровня: тяжёлая текстура + JSON. */
    S.levelResources = () => [
        { name: 'heavy', kind: 'texture', path: HEAVY },
        { name: 'small', kind: 'texture', path: 'tests/fixtures/loading/assets/small.png' },
    ];

    /**
     * Асинхронная загрузка сцены: ресурсы + инстанциация шагами $.task.
     * Игра на время загрузки ставит игровые часы на паузу (политика §44).
     */
    S.loadLevel = (opts) => {
        const o = opts || {};
        if (o.pauseClock !== false && !S.paused) { $.time.pause(); S.paused = true; }
        return $.scene.loadAsync('level', {
            resources: o.resources === undefined ? S.levelResources() : o.resources,
            title: 'Готовим уровень…',
            steps: [{ label: 'инстанциация', total: 600, work: (i) => { S.steps_done = i + 1; } }],
            loading: o.loading,
        });
    };

    S.loadScene = (name, opts) => $.scene.loadAsync(name, opts || {});
    S.pending = () => $.scene.pending();
    S.progress = () => { const h = $.scene.pending(); return h ? h.progress() : null; };
    S.cancelPending = () => $.scene.cancelPending('тест');
    S.handleState = () => { const h = $.scene.pending(); return h ? { state: h.state, error: h.error } : null; };
    S.resumeClock = () => { if (S.paused) { $.time.resume(); S.paused = false; } };
    S.clock = () => $.time.now();
    S.pausedNow = () => $.time.isPaused();

    /** Прямой запрос ресурсов (без сцены) — для бюджета и отмены. */
    // Имя уникально на запрос: реестр кэширует по имени, и повторный запрос
    // того же имени вернул бы уже готовую запись.
    S.req_seq = 0;
    S.requestHeavy = (path) => S.keepRequest($.resource.request([
        { name: 'probe' + (++S.req_seq), kind: 'texture', path: path || HEAVY },
    ]));
    S.requestBad = () => S.keepRequest($.resource.request([
        { name: 'bad', kind: 'texture', path: 'assets/нет-такого-файла.png' },
    ]));
    S.lastRequest = () => globalThis.__last_req;
    S.keepRequest = (req) => { globalThis.__last_req = req; return req; };
});
