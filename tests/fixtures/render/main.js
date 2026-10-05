// Фикстура теста режимов смешивания и заглушки render target.
//
// В кадре одновременно живут все четыре режима (alpha/add/multiply/none) плюс
// узел с неизвестным режимом: кадр обязан рисоваться, а счётчик спрайтов —
// включать все узлы. Render target в этой сборке не поддержан, поэтому
// тест проверяет только понятную ошибку, а не картинку.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 800, 600);

    // Подложка: кадр непустой даже без остальных узлов.
    $('<rect>', { id: 'base' }).at(400, 300).size(800, 600).color('#202838').appendTo($.world);

    // По одному узлу на каждый режим смешивания.
    $('<rect>', { id: 'b_alpha' }).at(220, 260).size(180, 140)
        .color('#ff5533cc').blend('alpha').appendTo($.world);
    $('<rect>', { id: 'b_add' }).at(400, 260).size(180, 140)
        .color('#4488ffcc').blend('add').appendTo($.world);
    $('<rect>', { id: 'b_multiply' }).at(580, 260).size(180, 140)
        .color('#ffdd66cc').blend('multiply').appendTo($.world);
    $('<rect>', { id: 'b_none' }).at(400, 430).size(180, 100)
        .color('#66ff99cc').blend('none').appendTo($.world);

    // Неизвестный режим: узел должен создаться, а режим — откатиться в alpha.
    $('<rect>', { id: 'b_bad' }).at(220, 430).size(120, 80)
        .color('#ffffff').blend('screen').appendTo($.world);
});
