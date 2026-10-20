// ===========================================================================
// $.devtools: безопасные правки на лету (§20 EDIT).
//
// Проверяется то, что не требует GUI: каждое поле идёт через существующую
// операцию $ и возвращает структурный { ok, selector, field, before, after,
// error }; неизвестное поле/селектор — ошибка, а не исключение; правится
// выбранный узел по умолчанию; editFields/overrideText видят те же значения.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/devtools_edit_test.mjs
// ===========================================================================

import './_harness.mjs';
import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { engine } from '../../src/highlevel/native.js';

// --- мок физики: те же вызовы движка, что у игры ---------------------------
let next_body = 1;
const velocity = new Map();
const body_enabled = new Map();
engine.STATIC = 1;
engine.DYNAMIC = 2;
engine.KINEMATIC = 3;
engine.createBody = () => next_body++;
engine.destroyBody = () => {};
engine.setPosition = () => {};
engine.getVelocity = (id) => velocity.get(id) || [0, 0];
engine.setVelocity = (id, vx, vy) => { velocity.set(id, [vx, vy]); };
engine.setGravityScale = () => {};
engine.setBodyEnabled = (id, on) => { body_enabled.set(id, on !== false); };
engine.bodyEnabled = (id) => body_enabled.get(id) !== false;
engine.bodyCount = () => 0;
engine.limits = () => ({ textures: 0, textures_max: 256, bodies: 0, bodies_max: 1024 });

const $ = createApi();
let seq = 0;
function node(tag, attrs) {
    const id = (attrs && attrs.id) || ('e' + (++seq));
    return $('<' + (tag || 'rect') + '>', Object.assign({}, attrs, { id }));
}

test('set(): позиция x/y — через .at(), вторая координата сохраняется', () => {
    node('rect', { id: 'hero', x: 5, y: 6 });
    const r = $.devtools.set('#hero', 'x', 42);
    eq(r.ok, true, 'правка удалась');
    eq(r.selector, '#hero', 'селектор в ответе');
    eq(r.field, 'x', 'поле в ответе');
    eq(r.before, 5, 'before');
    eq(r.after, 42, 'after');
    eq(r.error, null, 'нет ошибки');
    eq($('#hero').get(0).x, 42, 'x применён');
    eq($('#hero').get(0).y, 6, 'y не тронут');

    const r2 = $.devtools.set('#hero', 'y', -3.5);
    eq(r2.ok, true, 'y');
    eq($('#hero').get(0).y, -3.5, 'y применён');
    eq($('#hero').get(0).x, 42, 'x сохранён');
});

test('set(): угол в радианах и градусах, масштаб/scaleX/scaleY', () => {
    node('rect', { id: 'tr', x: 0, y: 0 });
    eq($.devtools.set('#tr', 'angle', Math.PI / 2).ok, true, 'angle');
    near($('#tr').get(0).angle, Math.PI / 2, 1e-9, 'угол в радианах');
    eq($.devtools.set('#tr', 'angleDeg', 45).ok, true, 'angleDeg');
    near($('#tr').get(0).angle, Math.PI / 4, 1e-9, 'угол из градусов');

    eq($.devtools.set('#tr', 'scale', 2).ok, true, 'scale');
    near($('#tr').get(0).scale_x, 2, 1e-9, 'sx');
    near($('#tr').get(0).scale_y, 2, 1e-9, 'sy');
    eq($.devtools.set('#tr', 'scaleX', 3).ok, true, 'scaleX');
    near($('#tr').get(0).scale_x, 3, 1e-9, 'sx изменён');
    near($('#tr').get(0).scale_y, 2, 1e-9, 'sy сохранён');
    eq($.devtools.set('#tr', 'scaleY', 4).ok, true, 'scaleY');
    near($('#tr').get(0).scale_y, 4, 1e-9, 'sy изменён');
    near($('#tr').get(0).scale_x, 3, 1e-9, 'sx сохранён');
});

test('set(): visible/enabled — существующие .visible()/.active()', () => {
    node('rect', { id: 'vis', x: 1, y: 2 });
    let r = $.devtools.set('#vis', 'visible', false);
    eq(r.ok, true, 'visible false');
    eq(r.before, true, 'before true');
    eq(r.after, false, 'after false');
    eq($('#vis').get(0).visible, false, 'узел скрыт');
    eq($.devtools.set('#vis', 'visible', true).ok, true, 'visible true');

    r = $.devtools.set('#vis', 'enabled', false);
    eq(r.ok, true, 'enabled false');
    eq(r.before, true, 'before enabled');
    eq(r.after, false, 'after enabled');
    eq($('#vis').processing('update'), false, 'обработка выключена');
    eq($.devtools.set('#vis', 'enabled', true).ok, true, 'enabled true');
    eq($('#vis').processing('update'), true, 'обработка включена');
});

test('set(): физические поля — velocity/gravity/gravityScale/bodyEnabled/sensor/static', () => {
    node('player', { id: 'phys', x: 10, y: 20 });
    const body = $('#phys').get(0).body;
    truthy(body >= 0, 'у player есть тело');

    let r = $.devtools.set('#phys', 'velocity', { x: 120, y: -40 });
    eq(r.ok, true, 'velocity');
    eq(r.after.x, 120, 'vx после');
    eq(r.after.y, -40, 'vy после');
    const v = $('#phys').velocity();
    eq(v.x, 120, 'скорость в теле vx');
    eq(v.y, -40, 'скорость в теле vy');

    eq($.devtools.set('#phys', 'gravity', false).ok, true, 'gravity false');
    eq($.devtools.set('#phys', 'gravityScale', 0).ok, true, 'gravityScale 0');
    eq($.devtools.set('#phys', 'gravityScale', 1).ok, true, 'gravityScale 1');
    r = $.devtools.set('#phys', 'gravityScale', 0.5);
    eq(r.ok, false, 'произвольный gravityScale отклонён');
    truthy(r.error.indexOf('0 или 1') >= 0, 'причина названа честно');

    const en = $.devtools.set('#phys', 'bodyEnabled', false);
    eq(en.ok, true, 'bodyEnabled false');
    eq(body_enabled.get(body), false, 'вызов дошёл до engine.setBodyEnabled');
    eq($.devtools.set('#phys', 'bodyEnabled', true).ok, true, 'bodyEnabled true');

    r = $.devtools.set('#phys', 'sensor', true);
    eq(r.ok, true, 'sensor');
    eq($('#phys').get(0).sensor, true, 'узел — сенсор');

    eq($.devtools.set('#phys', 'static', true).ok, true, 'static true');
    eq($('#phys').get(0).body_kind, 'static', 'тип тела static');
    eq($.devtools.set('#phys', 'static', false).ok, true, 'static false');
    eq($('#phys').get(0).body_kind, 'dynamic', 'вернулся dynamic');
    eq($.devtools.set('#phys', 'fixed', true).ok, true, 'fixed alias');
    eq($('#phys').get(0).body_kind, 'static', 'fixed → static');
    eq($.devtools.set('#phys', 'body', 'kinematic').ok, true, 'body kinematic');
    eq($('#phys').get(0).body_kind, 'kinematic', 'kinematic применён');
});

test('set(): цель по умолчанию — текущий выбор; uid тоже принимается', () => {
    const n = node('rect', { id: 'sel', x: 0, y: 0 });
    $.devtools.selectBy('#sel');
    const r = $.devtools.set(null, 'x', 77);
    eq(r.ok, true, 'null — текущий выбор');
    eq($('#sel').get(0).x, 77, 'применено к выбранному');
    const by_uid = $.devtools.set(n.get(0).uid, 'y', 88);
    eq(by_uid.ok, true, 'uid принимается');
    eq($('#sel').get(0).y, 88, 'y по uid');
});

test('set(): неизвестное поле/селектор/значение — структурная ошибка, не исключение', () => {
    node('rect', { id: 'bad', x: 0, y: 0 });
    const f = $.devtools.set('#bad', 'nope', 1);
    eq(f.ok, false, 'неизвестное поле');
    eq(f.before, null, 'before null');
    truthy(f.error.indexOf('доступны') >= 0, 'перечислены поля');

    const s = $.devtools.set('#no-such-node', 'x', 1);
    eq(s.ok, false, 'нет узла');
    eq(s.selector, '#no-such-node', 'селектор возвращён');
    truthy(s.error.indexOf('не найдена') >= 0, 'ошибка названа');

    const n = $.devtools.set('#bad', 'x', 'не число');
    eq(n.ok, false, 'мусор в числе');
    eq($('#bad').get(0).x, 0, 'узел не изменён');
});

test('setMany() и undo(): несколько полей и откат последней правки', () => {
    node('rect', { id: 'many', x: 1, y: 2 });
    const r = $.devtools.setMany('#many', { x: 10, visible: false, angleDeg: 180 });
    eq(r.ok, true, 'setMany удался');
    eq(r.applied, 3, 'применено три поля');
    eq($('#many').get(0).x, 10, 'x');
    eq($('#many').get(0).visible, false, 'visible');
    near($('#many').get(0).angle, Math.PI, 1e-9, 'angleDeg');

    // setMany применил три правки; undo откатывает последнюю (angleDeg).
    const u = $.devtools.undo();
    eq(u.ok, true, 'undo');
    eq(u.field, 'angleDeg', 'отменён angleDeg');
    near($('#many').get(0).angle, 0, 1e-9, 'угол вернулся');
    eq($('#many').get(0).x, 10, 'более ранняя правка осталась');
});

test('editFields(): список полей и текущие значения выбранного узла', () => {
    node('player', { id: 'fields', x: 12, y: 34 });
    $.devtools.selectBy('#fields');
    const data = $.devtools.editFields();
    eq(data.found, true, 'узел найден');
    eq(data.selector, '#fields', 'селектор');
    eq(data.values.x, 12, 'x');
    eq(data.values.y, 34, 'y');
    eq(data.values.visible, true, 'visible');
    eq(data.values.bodyEnabled, true, 'bodyEnabled из движка');
    eq(data.fields.find((f) => f.name === 'gravityScale').type, 'number', 'gravityScale — число');
    truthy(data.text.indexOf('x: 12') >= 0, 'текст содержит значения');
    eq($.devtools.editFields('#nope').found, false, 'несуществующий — found false');
});

test('overrideText(): готовый JS с существующими операциями $', () => {
    node('player', { id: 'ovr', x: 7, y: 8, visible: true });
    const text = $.devtools.overrideText('#ovr');
    truthy(typeof text === 'string', 'строка');
    truthy(text.indexOf("$('#ovr')") === 0, 'начинается с $("…")');
    truthy(text.indexOf('.at(7, 8)') >= 0, 'at');
    truthy(text.indexOf('.angle(') >= 0, 'angle');
    truthy(text.indexOf('.scale(') >= 0, 'scale');
    truthy(text.indexOf('bodyEnabled') >= 0, 'bodyEnabled назван комментарием');
    truthy(text.indexOf('.get(0).body') >= 0, 'bodyEnabled идёт через engine.setBodyEnabled');
    eq($.devtools.overrideText('#nope'), null, 'нет узла — null');
});

test('panel(): правки видны как факт', () => {
    node('rect', { id: 'paneled', x: 3, y: 4 });
    $.devtools.set('#paneled', 'x', 9);
    const p = $.devtools.panel();
    truthy(p.last_edit && p.last_edit.field === 'x', 'последняя правка в panel()');
    truthy(p.edit_history >= 1, 'история правок посчитана');
});

finish();
