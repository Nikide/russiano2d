// Фикстура tests/doc_examples_test.py: минимальный мир для фрагментов доки.
// Всё, чего в нём нет, фрагмент получает как заглушку (см. гейт).
$.ready(() => {
    $.world.gravity(0, 900).color('#101820').bounds(0, 0, 1280, 720);
    $('<sprite>', { id: 'hero' }).at(200, 300).size(32, 32).appendTo($.world);
    $('<ui.label>', { id: 'hud', text: 'HUD' }).at(20, 20).appendTo($.ui);
    $.agent.expose('docs', () => ({ ok: 1 }));
});
