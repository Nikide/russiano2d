// Фикстура task-66: бюджет/LOD света (I11) и мерцание эмиттера (I12).
//
// Камера в (400,300), зум 1 — мировые координаты совпадают с экранными, фон
// чёрный (свет только добавляет). Сцены собираются из теста функциями ниже:
//   * budgetScene(count, opts)  — сетка из count источников в кадре;
//   * budgetCustom(list)        — источники с заданными id/позицией/силой;
//   * budgetEmitters(count,opts)— сетка emission-спрайтов (для замера цены).
// Прежние узлы снимаются при каждом вызове: тест не тащит состояние между
// проверками, а числа качества считаются по фактическому миру.
const lamps = [];
const emitters = [];

function clearLights() {
    while (lamps.length) lamps.pop().remove();
}
function clearEmitters() {
    while (emitters.length) emitters.pop().remove();
}

$.ready(() => {
    $.camera.at(400, 300).zoom(1);
    $.world.gravity(0, 0).color('#000000');

    // Неосвещённая точка ВНЕ кадра: включает JS-проход мира (нативный проход C
    // не вызывает крючок emission-спрайта — без этого emitter-тест мерил бы не
    // тот путь). На пиксели не влияет: 1×1 в (-400,-400), за пределами экрана.
    $('<rect>', { id: 'js_path', x: -400, y: -400, w: 1, h: 1, color: '#000000' })
        .lit(false).appendTo($.world);

    globalThis.budgetScene = (count, opts) => {
        clearLights();
        clearEmitters();
        const o = opts || {};
        const cols = o.cols || 9;
        const rows = Math.ceil(count / cols);
        const margin = o.margin === undefined ? 60 : o.margin;
        const spanX = 680, spanY = 480;
        const stepX = cols > 1 ? spanX / (cols - 1) : 0;
        const stepY = rows > 1 ? spanY / (rows - 1) : 0;
        for (let i = 0; i < count; i++) {
            const col = i % cols, row = Math.floor(i / cols);
            // Детерминированный сдвиг ломает симметрию сетки: у всех источников
            // РАЗНОЕ расстояние до камеры, поэтому порядок приоритета однозначен.
            const x = margin + col * stepX + row * 3;
            const y = margin + row * stepY + col * 7;
            lamps.push($('<light>', {
                id: 'bl' + i,
                radius: o.radius === undefined ? 80 : o.radius,
                intensity: o.intensity === undefined ? 1 : o.intensity,
                color: o.color || '#ffffff',
                segments: o.segments === undefined ? 24 : o.segments,
                rings: o.rings === undefined ? 7 : o.rings,
                shadows: o.shadows === true,
            }).at(x, y).blend('add').appendTo($.world));
        }
        return lamps.length;
    };

    globalThis.budgetCustom = (list) => {
        clearLights();
        clearEmitters();
        for (const spec of list || []) {
            lamps.push($('<light>', {
                id: spec.id,
                radius: spec.radius === undefined ? 80 : spec.radius,
                intensity: spec.intensity === undefined ? 1 : spec.intensity,
                color: spec.color || '#ffffff',
                segments: spec.segments === undefined ? 24 : spec.segments,
                rings: spec.rings === undefined ? 7 : spec.rings,
                shadows: spec.shadows === true,
            }).at(spec.x, spec.y).blend('add').appendTo($.world));
        }
        return lamps.length;
    };

    globalThis.budgetEmitters = (count, opts) => {
        clearLights();
        clearEmitters();
        const o = opts || {};
        const cols = o.cols || 40;
        const rows = Math.ceil(count / cols);
        const stepX = cols > 1 ? 760 / (cols - 1) : 0;
        const stepY = rows > 1 ? 560 / (rows - 1) : 0;
        for (let i = 0; i < count; i++) {
            const col = i % cols, row = Math.floor(i / cols);
            emitters.push($('<rect>', {
                id: 'be' + i, fill: '#ffffff', w: 2, h: 2,
            }).emissive({
                color: '#ffffff',
                radius: o.radius === undefined ? 4 : o.radius,
                intensity: o.intensity === undefined ? 0.5 : o.intensity,
                segments: o.segments === undefined ? 6 : o.segments,
                rings: o.rings === undefined ? 1 : o.rings,
                flicker: o.flicker === undefined ? null : o.flicker,
            }).size(2, 2).at(20 + col * stepX, 20 + row * stepY).appendTo($.world));
        }
        return emitters.length;
    };

    globalThis.budgetClear = () => {
        clearLights();
        clearEmitters();
        return 0;
    };

    budgetScene(8);
});
