// Фикстура §22: страницы атласа, padding/extrusion, import-манифест, ошибки
// загрузки. Кадры лежат на реальных PNG (assets/*.png), поэтому проверять
// можно и пиксели: слева красный кадр, справа синий, вторая страница зелёная.
$.ready(() => {
    $.camera.at(400, 300).zoom(1);
    $.world.gravity(0, 0).color('#000000');
    $.gfx.filter(true);          // линейная фильтрация: проверяем протечку

    // Три атласа: обычные две страницы в одном файле, мультистраничный и
    // упакованный с padding/extrusion.
    const hero = $.atlas.load('hero', {
        path: 'assets/pages.json',
        data: {
            meta: { image: 'pages.png', size: { w: 64, h: 32 }, padding: 0, extrusion: 0,
                    frameTags: [{ name: 'run', from: 0, to: 1 }],
                    import: { version: 1, importer: 'r2d-atlas/1.0', hash: 'h1',
                              settings: { padding: 0 }, dependencies: ['raw/hero.ase'] } },
            frames: {
                run_0: { frame: { x: 0, y: 0, w: 32, h: 32 }, duration: 120 },
                run_1: { frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 80 },
            },
        },
        mipmaps: true,
    });

    const paged = $.atlas.load('paged', {
        path: 'assets/pages.json',
        data: {
            meta: { image: 'pages.png', size: { w: 64, h: 32 },
                    pages: [{ name: 'body', image: 'pages.png' },
                            { name: 'props', image: 'props.png' }] },
            frames: {
                body_0: { frame: { x: 0, y: 0, w: 32, h: 32 }, page: 'body' },
                prop_0: { frame: { x: 0, y: 0, w: 32, h: 32 }, page: 'props' },
            },
        },
    });

    const padded = $.atlas.load('padded', {
        path: 'assets/pages.json',
        data: {
            meta: { image: 'padded.png', size: { w: 64, h: 32 }, padding: 2, extrusion: 2 },
            frames: {
                pad_a: { frame: { x: 2, y: 2, w: 28, h: 28 } },
                pad_b: { frame: { x: 34, y: 2, w: 28, h: 28 } },
            },
        },
        mipmaps: true,
    });

    globalThis.atlasSheets = { hero, paged, padded };
    // Те же данные, что у hero: два кадра вплотную и без padding — проверка
    // $.atlas.verify() должна увидеть риск протечки предупреждением.
    globalThis.atlasData = () => JSON.parse(JSON.stringify({
        meta: { image: 'pages.png', size: { w: 64, h: 32 }, padding: 0, extrusion: 0,
                import: { version: 1, importer: 'r2d-atlas/1.0', hash: 'h1' } },
        frames: { run_0: { frame: { x: 0, y: 0, w: 32, h: 32 }, duration: 120 },
                  run_1: { frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 80 } },
    }));

    // Кадры: слева красный (run_0), по центру мультистраничный зелёный (prop_0).
    $('<sprite>', { id: 'sh', x: 300, y: 300 }).sprite(hero.frame('run_0'))
        .size(16, 16).appendTo($.world);
    $('<sprite>', { id: 'sp', x: 450, y: 300 }).sprite(paged.frame('prop_0'))
        .size(16, 16).appendTo($.world);
});
