// ===========================================================================
// Фикстура §9: транзакция комнаты и выгрузка.
//
// Сцена:
//   * вне комнаты — глобальный пол (#global_floor) и глобальная подписка на
//     'room:ping': они обязаны пережить и отказ сборки, и выгрузку;
//   * комната alpha — карта 3×3 (визуал, коллизия, occluders), инстанс prefab
//     crate_alpha: тело падает на ГЛОБАЛЬНЫЙ пол, поэтому касание
//     (collide/stay) продолжается каждый кадр, пока комната жива;
//   * комната trap_room — сборка ПАДАЕТ посередине: prefab 'trap' успевает
//     создать узел с телом, завести таймер и подписку в staging-области и
//     только потом бросает исключение. Отказ обязан вернуть мир к прежним
//     числам (узлы/тела/подписки/таймеры), а не оставить мусор.
//
// Таймер и подписка комнаты берутся под владение ЕЁ области явно (scope.every
// и $.signal.on с scope) — так игра и должна их заводить: §5 закрывает область
// при выгрузке. Проверяет tests/agent/highlevel_room_unload_test.py.
// ===========================================================================

const TRAP_ROOM = 'trap_room';
const TRAP_SCOPE = 'room:' + TRAP_ROOM;

globalThis.__ev = { collide: 0, stay: 0, timer: 0, sub: 0, global_sub: 0, trap_spawned: 0 };
const bump = (key) => { globalThis.__ev[key]++; };

$.ready(() => {
    $.world.gravity(0, 600).color('#101820').bounds(0, 0, 1280, 720);

    // Вне комнаты: пол и глобальная подписка. Остаются в мире всегда.
    $('<wall>', { id: 'global_floor' }).at(300, 500).size(420, 24).appendTo($.world);
    $.signal.on('room:ping', () => bump('global_sub'));

    // prefab, который падает ПОСЛЕ создания узла/тела/таймера/подписки.
    // Область сборки названа явно (её же передаёт $.fixture.enterTrap), поэтому
    // фабрика берёт её по имени, а не создаёт новую.
    $.prefab.register('trap', () => {
        const scope = $.scene.scope(TRAP_SCOPE);
        $('<rect>', { id: 'trap_node' }).at(700, 200).size(24, 24)
            .body('dynamic').appendTo($.world);
        scope.every(150, () => bump('timer'));
        $.signal.on('room:ping', () => bump('sub'), { scope: TRAP_SCOPE });
        globalThis.__ev.trap_spawned++;
        throw new Error('prefab «trap» падает намеренно: сборка комнаты не удалась');
    });

    const cells = [1, 1, 1, 1, 0, 1, 1, 1, 1];

    // crate — обычные данные: узел с телом. Обработчики касания вешает armRoom.
    $.prefab.register('crate', { tag: 'rect', id: 'crate', w: 24, h: 24, body: 'dynamic' });

    $.room.define('alpha', {
        schema: 1, id: 'alpha', bounds: { x: 0, y: 0, w: 1280, h: 720 },
        tilemap: {
            id: 'map_alpha', data: cells.slice(), cols: 3, rows: 3, mapW: 3, mapH: 3,
            solid: true, mergeCollisions: false, tileOccluders: true,
            src: 'assets/atlas.png', tile: 32, at: [900, 300],
        },
        instances: [{ prefab: 'crate', id: 'crate_alpha', x: 300, y: 200 }],
        markers: { spawn: { x: 64, y: 64 } },
    });
    $.room.define(TRAP_ROOM, {
        schema: 1, id: TRAP_ROOM, bounds: { x: 0, y: 0, w: 1280, h: 720 },
        instances: [{ prefab: 'trap', id: 'trap_a', x: 700, y: 200 }],
        markers: { spawn: { x: 32, y: 32 } },
    });

    $.fixture = {
        // Явное имя области: тест потом берёт её же для таймера/подписки.
        enterRoom: (id) => {
            const r = $.room.enter(id, { scope: 'room:' + id });
            return { ok: r.ok, id: r.id, stage: r.stage, code: r.code,
                     errors: (r.errors || []).map((e) => e.code + ': ' + e.message) };
        },
        enterTrap: () => $.fixture.enterRoom(TRAP_ROOM),
        unload: () => $.room.unload(),
        // Владение комнаты: таймер и подписка её области + обработчики касания
        // на её узле. Всё это обязано исчезнуть вместе с комнатой.
        armRoom: (id) => {
            const name = 'room:' + id;
            const scope = $.scene.scope(name);
            const crate = $('#crate_' + id);
            if (crate.length) {
                crate.contacts(true, { stay: true });
                crate.on('collide', () => bump('collide'));
                crate.on('stay', () => bump('stay'));
            }
            scope.every(150, () => bump('timer'));
            $.signal.on('room:ping', () => bump('sub'), { scope: name });
            return { scope: scope.name, timers: $.scene.counts().timers };
        },
        ping: () => { $.signal.emit('room:ping'); return true; },
        events: () => Object.assign({}, globalThis.__ev),
        counts: () => ({
            scene: $.scene.counts(),
            bodies: $.debug.limits().bodies,
            occluders: $.gfx.light.count(),
        }),
        state: () => ({
            room: $.room.current() ? $.room.current().id : null,
            scene: $.scene.current(),
            crate: $('#crate_alpha').length,
            map: $('#map_alpha').length,
            floor: $('#global_floor').length,
            trap_node: $('#trap_node').length,
        }),
    };
});

$.agent.expose('events', () => Object.assign({}, globalThis.__ev));
