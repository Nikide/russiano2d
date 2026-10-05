// Фикстура проверки Y-sort и террейнов TileMap
// (тест tests/agent/highlevel_tilemap_ysort_test.py).
//
// Карта 40×24 намеренно больше вьюпорта: видимых тайлов заведомо меньше всей
// карты. Рамка id 1 в набор террейна не входит, одиночный «камень» id 2 в
// (20, 12) — входит: после autotile по террейну он получает переход 20.
$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 1280, 720);

    const W = 40, H = 24;
    const rows = [];
    for (let y = 0; y < H; y++) {
        let row = '';
        for (let x = 0; x < W; x++) {
            const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
            const rock = x === 20 && y === 12;
            row += rock ? '2' : (border ? '1' : '.');
        }
        rows.push(row);
    }

    $.tilemap.fromASCII(rows, { '1': 1, '2': 2, '.': 0 }, {
        id: 'level',
        src: 'assets/atlas.png',
        tile: 32,
        cols: 8,
        solid: [1, 2],
        ysort: true,
        terrains: {
            // Одиночный тайл-камень (mask 0) рисуется переходом 20, остальное
            // берётся из общей раскладки base + форма.
            grass: { mode: 'bit16', base: 1, solid: [2], transitions: { 0: 20 } },
        },
    }).at(0, 0);

    $('<player>', { id: 'hero' }).at(0, 60).size(24, 40);
});
