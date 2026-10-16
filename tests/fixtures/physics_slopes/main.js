// ===========================================================================
// Фикстура §6.3: склоны — спуск, переход slope→flat, парковка на краю
// склона и нормаль опоры.
//
// Два одинаковых склона 30°, идущих вниз-вправо и без ступеньки
// продолжающихся ровной плитой (верх плиты — продолжение верхней грани
// склона). Первый склон — для спуска и перехода, второй — для парковки:
// актёры не толкают друг друга, и каждый узел проверяется независимо.
//
// Геометрия считается тригонометрией, а не подбирается «на глаз»: тест
// сверяет положение тела с аналитической поверхностью.
//
// Точные позиции узлов ставит сам тест (лучом, как highlevel_controls_test.py);
// здесь — геометрия, тела и стартовые точки над склоном.
// ===========================================================================

const SLOPE_DEG = 30;

function slopePair(suffix, originX) {
    const a = SLOPE_DEG * Math.PI / 180;
    const cx = originX, cy = 300, half = 200, thick = 24;

    // Вдоль склона (вниз-вправо) и нормаль его верхней грани.
    const dx = Math.cos(a), dy = Math.sin(a);
    const nx = Math.sin(a), ny = -Math.cos(a);

    const topStartX = cx - dx * half + nx * thick / 2;
    const topStartY = cy - dy * half + ny * thick / 2;
    const topEndX = cx + dx * half + nx * thick / 2;
    const topEndY = cy + dy * half + ny * thick / 2;

    $('<wall>', { id: 'slope-' + suffix }).at(cx, cy).size(half * 2, thick)
        .angle(a).attr({ friction: 1.0 }).appendTo($.world);
    // Ровная плита: её верх начинается ровно в конце верхней грани склона.
    $('<wall>', { id: 'flat-' + suffix })
        .at(topEndX + 250, topEndY + 16).size(500, 32)
        .attr({ friction: 1.0 }).appendTo($.world);

    return {
        deg: SLOPE_DEG, topStartX, topStartY, topEndX, topEndY, flatTopY: topEndY,
    };
}

$.ready(() => {
    $.world.gravity(0, 1800).color('#101820')
        .bounds(-800, -600, 6000, 2400, { solid: false });

    // Склон A (x ≈ 433..779) — спуск и переход slope→flat.
    // Склон B (x ≈ 2433..2779) — парковка.
    $.store.set('slopeGeom', { a: slopePair('a', 600), b: slopePair('b', 2600) });

    // Актёры. Клавиши у них разные (`wasd` против `arrows`): нажатие D в тесте
    // двигает только walker, остальные стоят на месте. Трение 1.0 >
    // tan(30°) = 0.577: на склоне тело держится, а не сползает. Трение (как и
    // у ящика ниже) задаётся ДО .collision(): оно пересоздаёт тело, а параметры
    // формы/трения читаются при создании (core.js setBody).
    $('<player>', { id: 'walker' }).at(500, 200).size(26, 30)
        .health(100).controls('wasd').attr({ friction: 1.0 })
        .collision(26, 30).appendTo($.world);
    $('<player>', { id: 'parker' }).at(2500, 200).size(26, 30)
        .health(100).controls('arrows').attr({ friction: 1.0 })
        .collision(26, 30).appendTo($.world);
    // Тот же игрок, но с трением по умолчанию (0.3 < tan 30° = 0.577): на нём
    // видно остаточное «ползание» вниз по склону, которое тест ограничивает.
    $('<player>', { id: 'parker-default' }).at(2560, 200).size(26, 30)
        .health(100).controls('arrows').collision(26, 30).appendTo($.world);
    $('<player>', { id: 'corner' }).at(2440, 150).size(26, 30)
        .health(100).controls('arrows').attr({ friction: 1.0 })
        .collision(26, 30).appendTo($.world);

    // Ящик без управления: трение 1.0 > tan(30°) = 0.577, поэтому на склоне
    // он обязан стоять, а не сползать, — проверка статического трения без
    // контроллера, который каждый кадр обнуляет горизонтальную скорость.
    // Трение задаётся ДО .body(): параметры тела читаются при его создании
    // (core.js setBody), у живого тела сеттера трения нет.
    $('<rect>', { id: 'crate' }).at(2700, 350).size(24, 24)
        .attr({ friction: 1.0 }).body('dynamic').appendTo($.world);
});
