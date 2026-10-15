// ===========================================================================
// Фикстура §39 (local/world transforms) и §40 (независимые sensors).
//
// Сцена намеренно детерминированная: гравитация выключена, тела без скорости
// стоят на месте, поэтому проверки не зависят от порядка подшагов физики.
//
//   * hero → pivot → marker: цепочка локальных трансформов (§39);
//   * weapon → muzzle: оружие с маркером дула (§39);
//   * ws_child: ребёнок в МИРОВЫХ координатах — так жил старый код;
//   * fighter: тело с основной капсулой (движение) и двумя областями —
//     контактный круг и прямоугольник меча (§40);
//   * dummy: цель, заранее стоящая внутри области меча;
//   * $.attack: дедупликация попаданий по стабильному окну атаки, а не по
//     native handle (пересоздание формы окно не сбрасывает).
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // --- §39: персонаж (100,200) → pivot (10,0) → marker (20,0) ------------
    $('<rect>', { id: 'hero' }).at(100, 200).size(32, 48).color('#4fd166').appendTo($.world);
    $('<rect>', { id: 'pivot' }).size(8, 8).color('#ffd34d').appendTo($('#hero'))
        .transformSpace('local').localAt(10, 0);
    $('<rect>', { id: 'marker' }).size(6, 6).color('#ff5c5c').appendTo($('#pivot'))
        .transformSpace('local').localAt(20, 0);
    // Ребёнок в мировых координатах: родитель его не тянет (совместимость).
    $('<rect>', { id: 'ws_child' }).at(500, 500).size(10, 10).appendTo($('#hero'));

    // --- §39: оружие и маркер дула -----------------------------------------
    $('<rect>', { id: 'weapon' }).size(40, 12).color('#7fa8ff').appendTo($('#hero'))
        .transformSpace('local').localAt(10, 0).localAngle(0);
    $('<rect>', { id: 'muzzle' }).size(4, 4).color('#ffffff').appendTo($('#weapon'))
        .transformSpace('local').localAt(20, 0);

    // --- §39+§40: дочерний сенсор с собственным телом ------------------------
    // Позиция считается композицией §39, тело переставляется проходом кадра:
    // flip и поворот родителя сенсор повторяет (приёмка §40 «Flip/rotation
    // следует §39»).
    $('<trigger>', { id: 'sword_sensor' }).size(24, 24).color('#ff9d3d')
        .appendTo($('#hero')).body('static').sensor(true)
        .transformSpace('local').localAt(20, 0);

    // --- §40: владелец с тремя независимыми областями ----------------------
    // Основная форма тела — капсула движения; области добавляются поверх.
    $('<player>', { id: 'fighter' }).at(400, 300).size(28, 40)
        .shape('capsule').gravity(false).appendTo($.world);
    $('#fighter').area('contact', { shape: 'circle', radius: 26, role: 'contact', sensor: true });
    $('#fighter').area('sword', {
        shape: 'box', w: 48, h: 18, x: 34, role: 'attack', sensor: true, enabled: false,
    });

    // Цель уже внутри прямоугольника меча (410..458 по x), но вне контактного
    // круга (радиус 26) — независимость областей видна сразу. Цель СТАТИЧНАЯ:
    // проверки не должны зависеть от того, куда её толкнула физика.
    $('<wall>', { id: 'dummy' }).at(456, 300).size(24, 24).appendTo($.world);

    // --- §40: контактная область с событиями -------------------------------
    // Не-сенсорная область: в событии видно И область, И логического владельца
    // (сам узел, раз owner не задан). Журнал нужен проверке «после
    // destroy/re-enable нет stale callbacks».
    $('#fighter').area('bump', { shape: 'box', w: 10, h: 10, x: 30, sensor: false, contacts: true, role: 'bump' });
    $.bump = [];
    $('#fighter').on('collide', (e) => {
        $.bump.push({
            kind: e.data.kind,
            area: e.data.selfArea,
            owner: e.data.selfOwner ? e.data.selfOwner.nid() : null,
            other: e.data.other ? e.data.other.nid() : null,
        });
    });

    // --- §40: попадание фиксируется по окну атаки, а не по handle ----------
    let window_id = 0;
    const struck = new Set();
    const hit_log = [];
    $.attack = {
        open() { window_id += 1; struck.clear(); return window_id; },
        window() { return window_id; },
        // Новые цели окна: одна цель = одно попадание за окно. Пересборка
        // native-формы (пересоздание тела) набор struck не трогает.
        sweep(owner, area) {
            const fresh = [];
            const list = $(owner).areaOverlap(area);
            for (let i = 0; i < list.length; i++) {
                const hit = list[i];
                const key = hit.node ? hit.node.nid() : ('body' + hit.body);
                if (struck.has(key)) continue;
                struck.add(key);
                fresh.push(key);
            }
            for (let i = 0; i < fresh.length; i++) hit_log.push(window_id + ':' + fresh[i]);
            return fresh;
        },
        log() { return hit_log.slice(); },
        reset() { hit_log.length = 0; struck.clear(); window_id = 0; },
    };
});
