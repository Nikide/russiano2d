// Фикстура тестов видов узла (`.kind()`, `$.kinds`) — фаза 1 docs/RE2D.md.
//
// Три прямоугольника: обычный 2D, узел особого вида 'probe', чей отрисовщик
// «берёт» узел (возвращает true), и узел вида 'skip', чей отрисовщик отказывается
// (false) — такой узел обязан нарисоваться обычным 2D-путём. Счётчики вызовов
// публикуются агенту.
globalThis.__calls = { probe: 0, skip: 0 };

$.ready(() => {
    $.world.gravity(0, 0).color('#101820');

    $.kinds.register('probe', { title: 'Берёт узел' });
    $.kinds.register('skip', { title: 'Отказывается' });
    $.kinds.renderer('probe', () => { globalThis.__calls.probe++; return true; });
    $.kinds.renderer('skip', () => { globalThis.__calls.skip++; return false; });

    $('<rect>', { id: 'flat' }).at(100, 100).size(20, 20).appendTo($.world);
    $('<rect>', { id: 'taken' }).at(200, 100).size(20, 20).kind('probe').appendTo($.world);
    $('<rect>', { id: 'fallback' }).at(300, 100).size(20, 20).kind('skip').appendTo($.world);
    $('<npc>', { id: 'russi' }).at(400, 100).kind(Re2D).appendTo($.world);
});

$.agent.expose('calls', () => globalThis.__calls);
