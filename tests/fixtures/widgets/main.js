// Фикстура теста UI-контролов: колонка с флажком, ползунком, полем и списком.
// Проверяется через агентский протокол (клики, ввод текста, значения).
$.ready(() => {
    $.world.color('#101820').bounds(0, 0, 800, 600);

    // Контейнер-колонка: дети раскладываются с gap/padding автоматически.
    const panel = $('<ui.col>', { id: 'panel', gap: 10, padding: 12 })
        .at(400, 300).size(320, 260).appendTo($.ui);

    $('<ui.checkbox>', { id: 'cb', text: 'Согласен' })
        .size(280, 28).appendTo(panel)
        .on('change', (e) => $.store.set('checked', e.data.checked));

    $('<ui.slider>', { id: 'vol', min: 0, max: 100, step: 5, value: 50 })
        .size(280, 28).appendTo(panel)
        .on('change', (e) => $.store.set('vol', e.data.value));

    $('<ui.input>', { id: 'name', maxLength: 16, placeholder: 'Имя' })
        .size(280, 32).appendTo(panel)
        .on('submit', (e) => $.store.set('submitted', e.data.value));

    $('<ui.list>', { id: 'list', items: ['один', 'два', 'три'], itemHeight: 24 })
        .size(200, 96).appendTo(panel)
        .on('select', (e) => $.store.set('picked', e.data.item));

    // Начальные значения в store: тест читает их через a.eval.
    $.store.set('checked', false);
    $.store.set('vol', 50);
    $.store.set('picked', null);
});
