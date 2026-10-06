// Фикстура интеграционного теста утилит: $.math, $.random, $.grid, $.csv.
//
// Здесь нет ни одной картинки: проверяется, что подсистемы живут в движке и
// дают предсказуемые значения. Всё, что нужно тесту, сложено в globalThis.
// Значения клеток и полей — латиницей: так вывод теста не зависит от
// кодировки канала агента.

$.ready(() => {
    $.world.gravity(0, 0).color('#101018');

    // --- $.grid: сетка 20×15 по 16 px ---------------------------------
    const grid = $.grid.make({ x: 0, y: 0, cell: 16, cols: 20, rows: 15, fill: 0 });
    $.grid.rect(grid, 2, 2, 4, 3, 'wall');           // 12 клеток
    $.grid.line(grid, 0, 14, 19, 14, 'ray');         // нижний ряд, 20 клеток
    globalThis.__grid = grid;
    globalThis.__walls = $.grid.count(grid, 'wall');
    globalThis.__rays = $.grid.count(grid, 'ray');
    globalThis.__flood = $.grid.flood(grid, 10, 10, 'water');
    globalThis.__water = $.grid.count(grid, 'water');
    globalThis.__zeros = $.grid.count(grid, 0);

    // Маленькая сетка для проверки связности заливки: две стены по диагонали.
    const small = $.grid.make({ cell: 8, cols: 3, rows: 3, fill: 0 });
    $.grid.set(small, 1, 0, 'x');
    $.grid.set(small, 0, 1, 'x');
    globalThis.__small = small;
    globalThis.__flood4 = $.grid.flood(small, 0, 0, 'y');

    const diag = $.grid.make({ cell: 8, cols: 3, rows: 3, fill: 0 });
    $.grid.set(diag, 1, 0, 'x');
    $.grid.set(diag, 0, 1, 'x');
    globalThis.__diag = diag;
    globalThis.__flood8 = $.grid.flood(diag, 0, 0, 'y', { diagonal: true });

    // --- Узел в центре клетки: связь сетки с миром ---------------------
    const center = $.grid.toWorld(grid, 5, 5);
    globalThis.__center = center;
    $('<sprite>', { id: 'marker' }).at(center.x, center.y).size(16, 16).appendTo($.world);
    globalThis.__cell_of_marker = $.grid.toCell(grid, center.x, center.y);

    // --- $.math --------------------------------------------------------
    globalThis.__clamped = $.math.clamp(15, 0, 10);
    globalThis.__lerped = $.math.lerp(0, 100, 0.25);
    globalThis.__vec_len = $.math.vecLength($.math.vec2(3, 4));
    globalThis.__angle = $.math.angleDiff(0, Math.PI * 1.5);
    globalThis.__rect_hit = $.math.rectOverlap(
        $.math.rect(0, 0, 10, 10), $.math.rect(5, 5, 10, 10));

    // --- $.random: один seed → одна последовательность ------------------
    const rng = $.random;
    globalThis.__roll = () => {
        const seq = [];
        for (let i = 0; i < 5; i++) seq.push(rng.int(0, 1000));
        return seq.join(',');
    };
    rng.seed(4242);
    globalThis.__seq1 = globalThis.__roll();
    rng.seed(4242);
    globalThis.__seq2 = globalThis.__roll();
    globalThis.__seed_now = rng.seed();
    globalThis.__noise_a = $.random.noise1D(12.5);
    globalThis.__noise_b = $.random.noise1D(12.5);

    // --- $.csv ---------------------------------------------------------
    globalThis.__table = $.csv.parseTable('name,damage\nsword,10\nshield,"5,5"');
    globalThis.__csv_rows = $.csv.parse('a,"b,c"\n1,2');
    globalThis.__csv_round = $.csv.parse($.csv.stringify([['a,b', 'c"d']]));
    globalThis.__tsv = $.csv.stringify([['a', 'b']], { delimiter: '\t' });
    globalThis.__json_ok = $.csv.jsonParse('{"hp": 7}');
    globalThis.__json_bad = $.csv.jsonParse('{broken', 'fallback');
});
