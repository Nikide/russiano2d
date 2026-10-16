// ===========================================================================
// Фикстура §9: транзакция СЦЕНЫ ($.scene.prepare → commit / discard).
//
//   * 'base'   — текущая сцена: узел с телом падает на ГЛОБАЛЬНЫЙ пол (вне
//                сцены), поэтому «старый мир остался валидным» проверяется
//                физикой, а не только счётчиками;
//   * 'broken' — prepare создаёт узел с телом, таймер и подписку и ПАДАЕТ;
//   * 'broken_flag' — prepare возвращает { ok: false } (второй путь отказа,
//                scene.js:464-467);
//   * 'good'   — корректная подготовка: enter создаёт свой узел, у сцены свой
//                таймер;
//   * 'staged' — подготовка с картой (тайлмап с occluders света) и таймером:
//                discard обязан убрать и узлы, и occluders, и таймер.
//
// Ручки prepare/commit/discard живут в globalThis.__handles: сам handle хранит
// ссылку на область и в JSON не сериализуется. Читает
// tests/agent/highlevel_scene_transaction_test.py.
// ===========================================================================

globalThis.__handles = {};
globalThis.__ev = { broken_spawned: 0, broken_timer: 0, broken_sub: 0, good_timer: 0,
                    staged_timer: 0, staged_sub: 0, global_sub: 0, entered_good: 0,
                    entered_broken: 0 };
const bump = (key) => { globalThis.__ev[key]++; };

$.ready(() => {
    $.world.gravity(0, 600).color('#101820').bounds(0, 0, 1280, 720);

    // Глобальный пол и глобальная подписка — вне любой сцены.
    $('<wall>', { id: 'global_floor' }).at(300, 500).size(420, 24).appendTo($.world);
    $.signal.on('tx:ping', () => bump('global_sub'));

    $.scene.add('base', {
        enter($) {
            $('<rect>', { id: 'base_node' }).at(300, 200).size(24, 24)
                .body('dynamic').appendTo($.world);
            $('<rect>', { id: 'base_marker' }).at(80, 80).size(12, 12).appendTo($.world);
        },
    });
    $.scene.load('base', { transition: 'none', scope: 'scene:base' });

    $.scene.add('broken', {
        prepare($, scope) {
            $('<rect>', { id: 'broken_node' }).at(700, 200).size(24, 24)
                .body('dynamic').appendTo($.world);
            scope.every(150, () => bump('broken_timer'));
            $.signal.on('tx:ping', () => bump('broken_sub'));
            globalThis.__ev.broken_spawned++;
            throw new Error('prepare сломан намеренно');
        },
        enter() { bump('entered_broken'); },
    });

    $.scene.add('broken_flag', {
        prepare($) {
            $('<rect>', { id: 'flag_node' }).at(800, 200).size(16, 16).appendTo($.world);
            return { ok: false, error: new Error('prepare отказался явно') };
        },
        enter() { bump('entered_broken'); },
    });

    $.scene.add('good', {
        prepare($) {
            $('<rect>', { id: 'good_node' }).at(600, 200).size(24, 24)
                .body('dynamic').appendTo($.world);
        },
        enter($) {
            bump('entered_good');
            $('<rect>', { id: 'good_marker' }).at(120, 120).size(10, 10).appendTo($.world);
        },
    });

    $.scene.add('staged', {
        prepare($, scope) {
            const cells = [1, 1, 1, 1, 0, 1, 1, 1, 1];
            $('<tilemap>', {
                id: 'staged_map', data: cells.slice(), cols: 3, rows: 3, mapW: 3, mapH: 3,
                solid: true, mergeCollisions: false, tileOccluders: true,
                src: 'assets/atlas.png', tile: 32,
            }).at(900, 300).appendTo($.world);
            scope.every(200, () => bump('staged_timer'));
            $.signal.on('tx:ping', () => bump('staged_sub'));
        },
    });

    function summary(handle) {
        return {
            name: handle.name, ok: handle.ok, stage: handle.stage,
            scope: handle.scope ? handle.scope.name : null,
            error: handle.error ? String(handle.error.message || handle.error) : null,
        };
    }

    $.fixture = {
        prepare: (slot, name) => {
            globalThis.__handles[slot] = $.scene.prepare(name);
            return summary(globalThis.__handles[slot]);
        },
        // Коммит ПОСЛЕДНЕГО подготовленного handle; возвращает сводку до/после.
        commit: (slot) => {
            $.scene.commit(globalThis.__handles[slot]);
            return { scene: $.scene.current(), names: $.scene.names().length };
        },
        discard: (slot) => $.scene.discard(globalThis.__handles[slot]),
        ping: () => { $.signal.emit('tx:ping'); return true; },
        events: () => Object.assign({}, globalThis.__ev),
        counts: () => ({
            scene: $.scene.counts(),
            bodies: $.debug.limits().bodies,
            occluders: $.gfx.light.count(),
        }),
        state: () => ({
            scene: $.scene.current(),
            scopes: $.scene.scopes(),
            base_node: $('#base_node').length,
            base_marker: $('#base_marker').length,
            broken_node: $('#broken_node').length,
            flag_node: $('#flag_node').length,
            good_node: $('#good_node').length,
            good_marker: $('#good_marker').length,
            staged_node: $('#staged_map').length,
            floor: $('#global_floor').length,
            base_y: $('#base_node').length ? $('#base_node').pos().y : null,
        }),
        // Живость старого мира: тело снова падает, если его поднять.
        dropBase: () => {
            $('#base_node').at(300, 200);
            engine.setVelocity($('#base_node').get(0).body, 0, 0);
            return true;
        },
        baseTouchingFloor: () => $.world.touching('#base_node', '#global_floor'),
    };
});

$.agent.expose('events', () => Object.assign({}, globalThis.__ev));
