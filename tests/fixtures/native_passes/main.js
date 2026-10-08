// Сцена сверки нативных проходов кадра (src/nodes.c) с прежним JS-путём:
// всё, что общий путь рисует сам (спрайты, прямоугольники, пивоты, масштаб,
// наследуемые альфа и видимость, вспышка, режимы смешивания, слои и глубина,
// отсечение), и всё, что он отдаёт обратно в JS (текст, круг, свет, тень,
// контур, свой отрисовщик). Анимации и случайности нет: два кадра подряд
// обязаны совпасть до пикселя.
$.ready(() => {
    $.world.gravity(0, 0).color('#10141c');
    $.camera.at(400, 300).zoom(1.25);
    $.camera.rotation && $.camera.rotation(0.15);

    for (let i = 0; i < 40; i++) {
        $('<rect>', { class: 'cell' })
            .at(60 + (i % 10) * 70, 80 + Math.floor(i / 10) * 90)
            .size(40 + (i % 3) * 8, 30 + (i % 4) * 6)
            .angle(i * 0.13)
            .color(['#e05252', '#52a0e0', '#e0c052', '#7ad07a'][i % 4])
            .alpha(0.4 + (i % 5) * 0.15)
            .layer(i % 3).depth((i * 7) % 5)
            .appendTo($.world);
    }
    $('<sprite>', { src: 'tiles.png', id: 'tex' }).at(300, 420).size(96, 64).pivot(0, 1).scale(1.5, 0.75).appendTo($.world);
    $('<rect>', { id: 'add' }).at(320, 300).size(120, 120).color('#3060ff').blend('add').appendTo($.world);

    const parent = $('<rect>', { id: 'parent' }).at(600, 420).size(80, 80).color('#ffffff').alpha(0.5).appendTo($.world);
    $('<rect>', { id: 'child' }).at(640, 440).size(50, 50).color('#ff00ff').alpha(0.6).appendTo(parent);
    const hidden = $('<rect>', { id: 'hidden' }).at(100, 500).size(60, 60).appendTo($.world).hide();
    $('<rect>', { id: 'hidden-child' }).at(110, 510).size(30, 30).appendTo(hidden);

    $('<rect>', { id: 'far' }).at(5000, 5000).size(40, 40).appendTo($.world);   // за экраном
    $('<rect>', { id: 'flash' }).at(200, 300).size(50, 50).color('#00ff00').appendTo($.world).flash('#ffffff', 100000);

    $('<circle>', { id: 'disc' }).at(500, 200).size(70, 70).color('#ffaa00').appendTo($.world);
    $('<text>', { id: 'label' }).at(80, 40).text('Сверка C и JS').fontSize(22).color('#e6edf3').appendTo($.world);
    $('<rect>', { id: 'shadowed' }).at(420, 500).size(50, 30).color('#cccccc')
        .shadow({ x: 4, y: 4, color: 'rgba(0,0,0,0.5)' }).outline(2, '#000000').appendTo($.world);
    $('<light>', { id: 'lamp', radius: 90, color: '#ffd9a0' }).at(700, 150).blend('add').appendTo($.world);
});
