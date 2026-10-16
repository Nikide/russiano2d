// ===========================================================================
// Фикстура §7: payload контакта областей.
//
// Проверяется контракт события `collide` у областей: `areaA`/`areaB`,
// `roleA`/`roleB`, `ownerA`/`ownerB` — имена, роли и ЛОГИЧЕСКИЕ владельцы, а не
// native-хендлы (api.js: `dispatchContacts`).
//
// Сцена подобрана так, чтобы сталкивались ТОЛЬКО две области и ни одна
// основная форма тела:
//   * #dummy  — динамическое тело, hurtbox-область без owner (владелец — сам
//               узел, путь «owner не задан»);
//   * #weapon — статичное тело, область sword с owner: '#guard' (владелец —
//               ДРУГОЙ узел, путь «owner разрешается по селектору»);
//   * #guard  — логический владелец sword, своей формы в контакте не имеет.
//
// Порядок создания задаёт стороны пары в Box2D: proxy-ключ растёт с id формы,
// поэтому раньше созданная область оказывается стороной A, позже созданная —
// стороной B. Тест опирается на это и проверяет ownerB === #guard.
//
// Читает тест tests/agent/highlevel_contact_area_payload_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // Объявления ролей и владельцев — ровно то, что уходит в area(...).
    const DECLARED = {
        hurtbox: { role: 'hurtbox', node: '#dummy', owner: null },
        sword: { role: 'attack', node: '#weapon', owner: '#guard' },
    };

    // 1. Цель: динамическое тело + hurtbox-область (без owner).
    $('<enemy>', { id: 'dummy' }).at(300, 300).size(28, 40).body('dynamic').appendTo($.world);
    $('#dummy').area('hurtbox', {
        shape: 'box', w: 120, h: 60, sensor: false, contacts: true,
        role: DECLARED.hurtbox.role,
    });

    // 2. Оружие: статичное тело, область sword, владелец — другой узел.
    $('<rect>', { id: 'weapon' }).at(500, 300).size(20, 20).body('static').appendTo($.world);
    $('#weapon').area('sword', {
        shape: 'box', w: 60, h: 40, x: -140, sensor: false, contacts: true,
        role: DECLARED.sword.role, owner: DECLARED.sword.owner,
    });

    // 3. Логический владелец sword: своей формы в контакте не имеет.
    $('<rect>', { id: 'guard' }).at(900, 600).size(16, 16).body('static').appendTo($.world);

    globalThis.__payloads = [];
    globalThis.__last = null;

    // Обработчик читает e.data — тот самый payload, который документирует §7.
    function record(who) {
        return (e) => {
            const d = e.data || {};
            globalThis.__payloads.push({
                who,
                kind: d.kind,
                keys: Object.keys(d).sort(),
                areaA: d.areaA === undefined ? null : d.areaA,
                areaB: d.areaB === undefined ? null : d.areaB,
                roleA: d.roleA === undefined ? null : d.roleA,
                roleB: d.roleB === undefined ? null : d.roleB,
                ownerA: d.ownerA ? d.ownerA.nid() : null,
                ownerB: d.ownerB ? d.ownerB.nid() : null,
                ownerA_type: typeof d.ownerA,
                ownerB_type: typeof d.ownerB,
                ownerA_nid_fn: !!(d.ownerA && typeof d.ownerA.nid === 'function'),
                ownerB_nid_fn: !!(d.ownerB && typeof d.ownerB.nid === 'function'),
                shapeA: d.shapeA === undefined ? null : d.shapeA,
                shapeB: d.shapeB === undefined ? null : d.shapeB,
                self: d.self ? d.self.nid() : null,
                other: d.other ? d.other.nid() : null,
                // Легаси-псевдонимы: остаются ради совместимости (их проверяют
                // другие тесты), но контракт §7 — шесть полей выше.
                selfArea: d.selfArea === undefined ? null : d.selfArea,
                otherArea: d.otherArea === undefined ? null : d.otherArea,
            });
            globalThis.__last = d;
        };
    }
    $('#dummy').on('collide', record('dummy'));
    $('#weapon').on('collide', record('weapon'));

    $.fixture = {
        declared: DECLARED,
        payloads: () => globalThis.__payloads.slice(),
        seen: () => globalThis.__last,
    };
});

$.agent.expose('payloads', () => globalThis.__payloads);
