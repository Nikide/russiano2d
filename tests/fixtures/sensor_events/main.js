// Фикстура D8-I8: сенсор пропускает сквозь и присылает enter/exit.
// «Enter» — событие collide с sensor:true, «exit» — separate с sensor:true
// (docs/highlevel/physics.md: sensor(true) — проходить сквозь, но получать
// события). Тест доказывает числами, что это работает.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    const ev = {
        collide: 0, separate: 0,
        enter: 0, exit: 0,
        sensor_flag: 0,      // у сенсорного события sensor === true
        normal_null: 0,      // нормали у сенсора нет (hasNormal === false)
        point_null: 0,       // и точки касания нет
    };

    $('<rect>', { id: 'zone' }).at(400, 300).size(200, 200)
        .body('static').sensor(true).appendTo($.world);
    $('<rect>', { id: 'probe' }).at(100, 300).size(20, 20)
        .body('dynamic').appendTo($.world);

    $('#zone').on('collide', (e) => {
        ev.collide++;
        if (e.data.sensor === true) {
            ev.enter++;
            ev.sensor_flag++;
            if (e.data.hasNormal === false && e.data.nx === null) ev.normal_null++;
            if (e.data.hasPoint === false) ev.point_null++;
        }
    });
    $('#zone').on('separate', (e) => {
        ev.separate++;
        if (e.data.sensor === true) ev.exit++;
    });

    $.agent.expose('sensorEvents', () => ev);
});
