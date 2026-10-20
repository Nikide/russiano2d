// {{name}} — минимальный платформер на высокоуровневом API $.
$.ready(() => {
    $.gfx.color('#0b0e14');
    $.world.gravity(0, 1600).bounds(0, -400, 3200, 1400);

    $('<wall>').at(1600, 660).size(3200, 40).color('#232b3d').appendTo($.world);
    for (const [x, y, w] of [[500, 540, 220], [900, 440, 220], [1300, 340, 220]]) {
        $('<wall>').at(x, y).size(w, 24).color('#2f3a55').appendTo($.world);
    }

    $('<player>', { id: 'hero' })
        .at(200, 560)
        .size(28, 40)
        .health(100)
        .controls('both')
        .appendTo($.world);

    $.camera.follow('#hero', { smooth: 0.15 }).limits(0, -400, 3200, 1400);
});
