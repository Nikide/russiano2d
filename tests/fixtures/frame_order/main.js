// ===========================================================================
// Фикстура §8: фактический порядок фаз кадра.
//
// Фикстура пишет ТОЛЬКО метки, каждая — из своей фазы (см. installFrameHooks,
// src/highlevel/api.js:2078-2165, и docs/FRAME_PHASES.md):
//
//   contact      — обработчик 'stay' узла: фаза 2 «контакты» (dispatchContacts).
//                  'stay' включён явно (.contacts(true, {stay: true})): это
//                  opt-in, и без него касание не повторяется каждый кадр;
//   scene_update — update() сцены: фаза 6;
//   game_update  — хук $.update: фаза 7 (после update сцены);
//   anim         — fn-дорожка клипа $.anim: подсистема «анимация» (tickAnim),
//                  идёт ПОСЛЕ хуков $.update;
//   cleanup      — scope.onClosed: закрытие области владения финализируется в
//                  безопасной фазе — tickLifecycle («области», api.js:2142),
//                  тоже после логики игры, но до отрисовки;
//   scene_render — render() сцены: фаза отрисовки, самая первая в setRender;
//   render       — хук $.render: та же фаза, после render сцены.
//
// Мир строится в enter сцены (переход со своей областью не сносит мир).
// Читает тест tests/agent/highlevel_frame_order_test.py.
// ===========================================================================

globalThis.__order = [];
const mark = (what) => globalThis.__order.push(what);

$.ready(() => {
    $.world.gravity(0, 900).color('#101820').bounds(0, 0, 1280, 720);

    // Клип с fn-дорожкой: единственный штатный способ попасть кодом в фазу
    // tickAnim, не трогая движок.
    $.anim.define('order_tick', {
        duration: 1000, loop: 'loop',
        tracks: [{ fn: () => mark('anim') }],
    });

    $.scene.add('order', {
        enter($) {
            mark('scene_enter');
            $('<wall>', { id: 'floor' }).at(300, 420).size(320, 24).appendTo($.world);
            $('<rect>', { id: 'faller' }).at(300, 380).size(20, 20)
                .body('dynamic').appendTo($.world);
            // Касание продолжается: событие 'stay' каждый кадр (фаза контактов).
            $('#faller').contacts(true, { stay: true });
            $('#faller').on('stay', () => mark('contact'));
            $('#faller').playClip('order_tick');
        },
        update() { mark('scene_update'); },
        render() { mark('scene_render'); },
    });
    $.scene.load('order', { transition: 'none', scope: true });

    $.update(() => mark('game_update'));
    $.render(() => mark('render'));

    $.fixture = {
        order: () => globalThis.__order.slice(),
        reset: () => { globalThis.__order.length = 0; return true; },
        // Область закрывается МЕЖДУ кадрами: её onClosed придёт в безопасной
        // фазе следующего кадра (tickLifecycle), т.е. внутрь его трассы.
        armCleanup: () => {
            const scope = $.scene.scope('order:cleanup');
            scope.onClosed(() => mark('cleanup'));
            return scope.close();
        },
        onClosedFired: () => globalThis.__closed || 0,
    };
});

$.agent.expose('order', () => globalThis.__order.slice());
