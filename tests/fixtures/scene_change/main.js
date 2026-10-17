// ===========================================================================
// Фикстура task-65: смена сцены, экран загрузки, отмена и подготовка.
//
// Сцены: 'a','b','c' — простые миры с узлом; 'lit' — включает глобальный
// свет/темноту (проверка A3); 'async' — сборка шагами (A1); 'prepared' —
// без собственного prepare (prepare() строит её через enter, A0.6).
//
// События жизненного цикла складываются в globalThis.__ev (только данные,
// без ссылок на узлы), их читает tests/agent/scene_change_test.py.
// ===========================================================================

globalThis.__ev = {
    before: [],
    after: [],
    error: [],
    progress: [],
    enter: [],
    exit: [],
    steps: 0,
    loading_frames: 0,     // кадров, где был виден встроенный экран
    paused_frames: 0,      // кадров, где мир был на паузе во время загрузки
    muted_frames: 0,       // кадров, где звук был заглушён
};

const ev = globalThis.__ev;

function simple(name) {
    return {
        enter($) {
            ev.enter.push(name);
            $('<rect>', { id: 'node_' + name }).at(100, 100).size(20, 20)
                .body('static').appendTo($.world);
        },
        exit() { ev.exit.push(name); },
    };
}

$.ready(() => {
    // Светлый фон: по скриншоту видно, где прошла шторка/шахматка.
    $.world.gravity(0, 0).color('#e8e8e8').bounds(0, 0, 1280, 720);
    $.scene.transition('fade', 300);

    $.scene.add('a', simple('a'));
    $.scene.add('b', simple('b'));
    $.scene.add('c', simple('c'));

    // A3: сцена сама включает свет и темноту. После смены они обязаны
    // вернуться в исходное состояние.
    $.scene.add('lit', {
        enter($) {
            ev.enter.push('lit');
            $('<rect>', { id: 'node_lit' }).at(120, 120).size(20, 20).appendTo($.world);
            $.gfx.light.ambient({ level: 0.85, color: '#101020' });
            $.gfx.light.map({ on: true, intensity: 1.5 });
        },
        exit() { ev.exit.push('lit'); },
    });

    // A1: сборка идёт шагами, поэтому экран загрузки виден несколько кадров.
    $.scene.add('async', simple('async'));

    // A0.6: у сцены нет prepare — prepare() обязан построить её через enter.
    $.scene.add('prepared', {
        enter($) {
            ev.enter.push('prepared');
            $('<rect>', { id: 'node_prepared' }).at(300, 300).size(20, 20)
                .body('static').appendTo($.world);
        },
        exit() { ev.exit.push('prepared'); },
    });

    $.on('scene:before-change', (e) => {
        ev.before.push({ from: e.data.from, to: e.data.to,
                         transition: e.data.transition, ms: e.data.ms });
    });
    $.on('scene:after-change', (e) => {
        ev.after.push({ from: e.data.from, to: e.data.to, transition: e.data.transition });
    });
    $.on('scene:error', (e) => {
        ev.error.push({ from: e.data.from, to: e.data.to,
                        code: e.data.code, message: e.data.message });
    });
    $.on('scene:progress', (e) => {
        ev.progress.push({ total: e.data.total, done: e.data.done,
                           ratio: e.data.ratio, label: e.data.label });
    });

    // Наблюдение за экраном загрузки: живёт после сцены, поэтому видит уже
    // показанный экран и снятую паузу.
    $.update(() => {
        if ($.loading.visible()) ev.loading_frames++;
        if ($.time.isPaused()) ev.paused_frames++;
        if ($.sound.mute()) ev.muted_frames++;
    });

    $.agent.expose('ev', () => ev);

    $.scene.load('a', { transition: 'none' });
});
