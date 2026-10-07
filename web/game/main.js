// ---------------------------------------------------------------------------
// Спайк веб-экспорта: минимальная игра для проверки, что движок в браузере
// действительно рисует кадр.
//
// Ничего, кроме `$`: фигуры, текст и анимация по $.update. Никакого RmlUi и
// пост-обработки — в первой веб-сборке они выключены (см. cmake/Web.cmake).
//
// Признак успеха: в кадре видны цветные прямоугольники, круг и текст, а в
// консоли браузера — строки [r2d] из engine.log.
// ---------------------------------------------------------------------------

$.ready(() => {
    $.world.color('#0d1117');

    $('<rect>', { id: 'bg' })
        .at(engine.width / 2, engine.height / 2)
        .size(engine.width, engine.height)
        .color('#161b22')
        .layer(-10)
        .appendTo($.world);

    for (let i = 0; i < 5; i++) {
        $('<rect>', { class: 'tile' })
            .at(200 + i * 120, 260)
            .size(90, 90)
            .color(['#e05252', '#e0a352', '#7ad07a', '#5aa9e0', '#b98ae0'][i])
            .appendTo($.world);
    }

    $('<circle>', { id: 'orb' })
        .at(engine.width / 2, 480)
        .size(120, 120)
        .color('#ffd54a')
        .appendTo($.world);

    $('<text>', { id: 'caption' })
        .at(24, 40)
        .text('Russiano2D в браузере (WebGPU)')
        .fontSize(28)
        .color('#e6edf3')
        .appendTo($.world);

    engine.log('веб-сцена построена: ' + engine.width + 'x' + engine.height);
});

// Двигаем круг по кругу и «дышим» плитками — если кадры идут, это видно.
$.update((dt) => {
    const t = $.time.now();
    const orb = $('#orb');
    const cx = engine.width / 2 + Math.cos(t * 1.7) * 260;
    const cy = 480 + Math.sin(t * 2.3) * 90;
    orb.at(cx, cy);

    $('.tile').each((i, el) => {
        el.alpha(0.55 + 0.45 * Math.sin(t * 3 + i));
    });
});
