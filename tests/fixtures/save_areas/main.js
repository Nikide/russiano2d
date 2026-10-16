// ===========================================================================
// Фикстура §10: области актёра как часть состояния узла.
//
// Два узла с телами и областями: `guard` (неподвижный, hurtbox выключается
// тестом) и `blade` (атакующая область, владелец — guard). Тест сохраняет слот
// с выключенным hurtbox, ломает состояние и загружает слот: области обязаны
// вернуться вместе с геометрией, ролями и ВКЛЮЧЁННОСТЬЮ, а владелец-blade —
// снова указывать на guard, а не на самого себя.
//
// Мир намеренно пустой по поведению: фикстура не двигает узлы, чтобы проверка
// зависела только от сейва, а не от физики.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 640, 360);

    const guard = $('<rect>', { id: 'guard', x: 200, y: 180, w: 40, h: 40 })
        .color('#4fd166');
    guard.body('static');
    guard.area('hurtbox', { role: 'hurtbox', w: 40, h: 40, sensor: true });

    const blade = $('<rect>', { id: 'blade', x: 260, y: 180, w: 24, h: 12 })
        .color('#ffaa00');
    blade.body('static');
    blade.area('attack', {
        role: 'attack', w: 48, h: 20, x: 14, sensor: true,
        owner: guard, enabled: false,
    });

    // Наблюдаемое состояние для теста: сколько областей и в каком они виде.
    $.store.set('areaReport', () => ({
        guard: guard.areas().map((a) => ({ name: a.name, enabled: a.enabled, role: a.role, w: a.w, h: a.h })),
        blade: blade.areas().map((a) => ({ name: a.name, enabled: a.enabled, role: a.role, w: a.w, h: a.h })),
    }));
});
