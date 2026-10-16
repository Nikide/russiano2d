// ===========================================================================
// Фикстура §7.2: пересборка формы области.
//
// Одна и та же область 'reach' объявляется дважды: сначала большой сенсор
// 200×60, затем крошечный 2×2 в центре тела. Проверяется:
//   * большая форма реально накрывает цель (areaOverlap = 1) и присылает
//     событие контакта;
//   * после переопределения старой геометрии НЕ остаётся: areaOverlap = 0 и
//     новая цель, поставленная точно в прежний «след» формы, не получает
//     ни одного контакта (нет ghost contact);
//   * идентичность области держит имя (core.js:1026-1028), а индекс формы при
//     смене геометрии СОХРАНЯЕТСЯ: engine.setShape возвращает тот же индекс
//     (script.c:1510-1514, physics.c:799-836) — identity не плавает;
//   * возврат геометрии снова делает область участником (новая форма вступает
//     в силу).
//
// Цель — ДИНАМИЧЕСКОЕ тело без гравитации: Box2D сообщает сенсору только о
// динамических/кинематических телах, а сенсор тела не толкает, поэтому сцена
// детерминирована (скоростей нет, #fighter и #target стоят на месте).
//
// Читает тест tests/agent/highlevel_area_rebuild_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    $('<player>', { id: 'fighter' }).at(400, 300).size(28, 40)
        .gravity(false).appendTo($.world);

    // Сенсор с событиями: большая форма дотягивается до (530,300).
    $('#fighter').area('reach', {
        shape: 'box', w: 200, h: 60, x: 130, sensor: true, contacts: true, role: 'reach',
    });

    $('<wall>', { id: 'target' }).at(530, 300).size(24, 24)
        .body('dynamic').gravity(false).appendTo($.world);

    globalThis.__hits = 0;
    globalThis.__events = [];
    $('#fighter').on('collide', (e) => {
        const d = e.data || {};
        globalThis.__hits++;
        globalThis.__events.push({
            kind: d.kind, areaA: d.areaA === undefined ? null : d.areaA,
            areaB: d.areaB === undefined ? null : d.areaB, sensor: d.sensor === true,
        });
    });

    $.fixture = {
        // Копия описания области: тест видит ровно то, что отдаёт публичный API.
        area: (name) => {
            const a = $('#fighter').area(name);
            return a ? JSON.parse(JSON.stringify(a)) : null;
        },
        areas: () => $('#fighter').areas(),
        overlap: (name) => $('#fighter').areaOverlap(name).length,
        hits: () => globalThis.__hits,
        events: () => globalThis.__events.slice(),
        // Переопределить ТУ ЖЕ область другим описанием (имя не меняется).
        redefine: (opts) => {
            $('#fighter').area('reach', opts);
            const a = $('#fighter').area('reach');
            return a ? JSON.parse(JSON.stringify(a)) : null;
        },
        spawnTarget: (id, x, y) => {
            $('<wall>', { id }).at(x, y).size(24, 24)
                .body('dynamic').gravity(false).appendTo($.world);
            return $('#' + id).nid();
        },
    };
});

$.agent.expose('hits', () => globalThis.__hits);
$.agent.expose('events', () => globalThis.__events.slice());
