// Фикстура студий данных SDK: игра читает файлы форматов так, как описано в docs/SDK.md.
$.ready(() => {
    $.gfx.color('#0b0e14');
    $('<tilemap>', $.fs.readJSON('level.tilemap.json')).at(480, 300).appendTo($.world);
});
