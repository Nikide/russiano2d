// {{name}} — карта читается из level.tilemap.json (Tilemap Studio), код остаётся кодом.
$.ready(() => {
    $.gfx.color('#0b0e14');
    $.world.gravity(0, 0);

    const level = $.fs.readJSON('level.tilemap.json');
    const map = $('<tilemap>', level).at(640, 360).appendTo($.world);
    if (level.autotile) map.autotile(level.autotile);

    $('<player>', { id: 'hero' }).at(640, 360).size(24, 24).controls('wasd').gravity(false).appendTo($.world);
    $.camera.follow('#hero', { smooth: 0.15 });
});
