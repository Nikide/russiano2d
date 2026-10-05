// ===========================================================================
// Фикстура тестов prefab-системы ($.prefab).
//
// Строит прототип, регистрирует его, наследует с переопределением свойств,
// инстанцирует пачкой, клонирует, сохраняет в $.store и целиком пересобирает
// сцену. Результаты складываются в $.store, откуда их читает
// tests/agent/highlevel_prefab_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820');
    // Пишем в build/, чтобы не затирать save.json игры.
    $.store.file('build/test_prefab_save.json');

    // --- Прототип: игрок с ребёнком-шляпой, классами и данными --------------
    const proto = $('<player>').at(100, 100).size(28, 40).appendTo($.world);
    proto.hp(100);
    proto.addClass('prototype');
    proto.data('score', 5);
    $('<rect>', { class: 'hat' }).at(0, -20).size(20, 10).appendTo(proto);

    $.prefab.register('hero', $.prefab.save(proto));
    proto.remove();

    // --- Наследование: hero-fast = hero + hp/size/speed + плащ ---------------
    $.prefab.register('hero-fast', {
        extend: 'hero',
        overrides: { hp: 50, size: [40, 60], speed: 400 },
        add: [{ tag: 'rect', class: 'cape', w: 10, h: 20, x: -10, y: 0 }],
    });

    // --- Инстанцирование -----------------------------------------------------
    $.prefab.instantiate('hero', { id: 'hero1', x: 200, y: 200, parent: $.world });
    const crowd = $.prefab.instantiate('hero-fast', {
        count: 3, class: 'crowd', x: 420, y: 200, parent: $.world,
    });
    $.store.set('crowdCount', crowd.length);

    // Занятый id не должен ломать первый '#hero1'.
    const twin = $.prefab.instantiate('hero', { id: 'hero1', x: 260, y: 200, parent: $.world });
    $.store.set('twinId', twin.get(0).id);

    // --- Клон рядом с оригиналом --------------------------------------------
    const clone = $.prefab.clone('#hero1');
    $.store.set('cloneId', clone.get(0).id);
    $.store.set('cloneChildren', clone.get(0).child_nodes.length);
    $.store.set('heroPrefabName', $('#hero1').prefab());
    $.store.set('crowdPrefabName', $('.crowd').first().prefab());

    // --- Файлы через $.store -------------------------------------------------
    $.prefab.saveTo('hero-saved', '#hero1');
    $.prefab.loadFrom('hero-saved', { id: 'hero-restored', x: 800, y: 200, parent: $.world });

    // --- Весь мир → сцена → восстановление ----------------------------------
    $.prefab.saveScene('level');
    $.store.set('beforeScene', $.world.count());
    $('<rect>', { class: 'junk' }).at(0, 0).appendTo($.world);
    $.prefab.loadScene('level', { clear: true });
});
