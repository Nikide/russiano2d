// ===========================================================================
// Юнит-тесты камеры Re2D (`$.camera.kind(Re2D)`) — фаза 3 docs/RE2D.md.
//
// Нативную проекцию (engine.re2d.*) здесь подменяет заглушка, поэтому
// проверяется ровно JS-слой: методы, углы и их границы, перевод зума и тряски в
// параметры вида, снимки, слежение и взгляд мышью. Сама математика перспективы
// проверена отдельно: tests/re2d/re2d_test.c и tests/agent/re2d_native_test.py.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/camera_re2d_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { re2dViewOf, cameraTransform } from '../../src/highlevel/camera.js';
import { registerKindPass, kindPass } from '../../src/highlevel/kinds.js';
import { ctx } from '../../src/highlevel/core.js';

const $ = createApi();
const DEG = Math.PI / 180;

// Заглушка нативного ядра: запоминает вызовы, проекция — «x, y как есть».
const calls = { view: [], project: 0, unproject: [] };
engine.re2d = {
    view: (...args) => { calls.view.push(args); return true; },
    project: (points, out) => { calls.project++; out[0] = points[0]; out[1] = points[1]; out[2] = 0.5; out[3] = 2; return 1; },
    unproject: (sx, sy, z) => { calls.unproject.push([sx, sy, z]); return [sx + 1, sy + 2]; },
    info: () => ({ stats: {} }),
};
let locked = false;
engine.mouseLock = (flag) => { if (flag !== undefined) locked = !!flag; return locked; };

function reset() {
    $.camera.kind(null).rotation(0);
    $.camera.yaw(0).at(0, 0).zoom(1).pitch(0).eye(48).fov(70).fog(0, 0.25).unfollow();
    $.camera.limits(null);
    $.camera.mouseLook({ on: false, sensitivity: 0.0025 });
    $('*').remove();
    calls.view.length = 0; calls.project = 0; calls.unproject.length = 0;
}

test('камера по умолчанию 2D, kind меняется и возвращается', () => {
    reset();
    eq($.camera.kind(), '2d', 'вид по умолчанию');
    $.camera.kind(Re2D);
    eq($.camera.kind(), 're2d', 'после kind(Re2D)');
    $.camera.kind(null);
    eq($.camera.kind(), '2d', 'после kind(null)');
    let message = '';
    try { $.camera.kind('3d'); } catch (error) { message = String(error.message); }
    truthy(message.includes('доступны'), `неизвестный вид — подсказка: ${message}`);
});

test('yaw/pitch/fov в градусах, rotation в Re2D — тот же yaw в радианах', () => {
    reset();
    $.camera.yaw(90);
    near($.camera.yaw(), 90, 1e-9, 'yaw читается в градусах');
    eq($.camera.rotation(), 0, 'в 2D rotation() — крен кадра, yaw в него не течёт');
    $.camera.kind(Re2D);
    near($.camera.rotation(), Math.PI / 2, 1e-9, 'в Re2D rotation() в радианах — это yaw');
    $.camera.rotation(Math.PI);
    near($.camera.yaw(), 180, 1e-9, 'rotation() в Re2D пишет yaw');
    $.camera.pitch(30); near($.camera.pitch(), 30, 1e-9, 'pitch');
    $.camera.fov(100); near($.camera.fov(), 100, 1e-9, 'fov');
});

test('границы: pitch ±85°, fov 5..170°, yaw в (-180, 180]', () => {
    reset();
    $.camera.pitch(200); near($.camera.pitch(), 85, 1e-9, 'pitch сверху');
    $.camera.pitch(-200); near($.camera.pitch(), -85, 1e-9, 'pitch снизу');
    $.camera.fov(1); near($.camera.fov(), 5, 1e-9, 'fov снизу');
    $.camera.fov(400); near($.camera.fov(), 170, 1e-9, 'fov сверху');
    $.camera.yaw(190); near($.camera.yaw(), -170, 1e-6, 'yaw 190° → -170°');
    $.camera.yaw(-540); near($.camera.yaw(), 180, 1e-6, 'yaw -540° → 180°');
});

test('look(dx, dy): вправо — поворот направо, вверх — взгляд вверх', () => {
    reset();
    $.camera.mouseLook({ sensitivity: 0.01 });
    $.camera.look(100, 0);
    near($.camera.yaw(), 1.0 / DEG, 1e-9, 'сдвиг мыши вправо увеличивает yaw');
    $.camera.look(0, -50);
    near($.camera.pitch() * DEG, 0.5, 1e-9, 'сдвиг мыши вверх (dy < 0) поднимает взгляд');
    $.camera.look(0, 10000);
    near($.camera.pitch(), -85, 1e-9, 'взгляд вниз упирается в -85°');
});

test('yaw при вращении мышью не растёт бесконечно', () => {
    reset();
    $.camera.mouseLook({ sensitivity: 0.1 });
    for (let i = 0; i < 1000; i++) $.camera.look(100, 0);   // много оборотов
    truthy(Math.abs($.camera.yaw()) <= 180 + 1e-9, `yaw в пределах 180°: ${$.camera.yaw()}`);
});

test('mouseLook включает захват мыши и возвращает состояние', () => {
    reset();
    eq($.camera.mouseLook(), false, 'по умолчанию выключен');
    $.camera.mouseLook(true);
    eq($.camera.mouseLook(), true, 'включён');
    eq(locked, true, '$.window.mouseLock(true) вызван');
    $.camera.mouseLook(false);
    eq(locked, false, 'захват снят');
    $.camera.mouseLook({ sensitivity: 0.004 });
    near($.camera.info().sensitivity, 0.004, 1e-12, 'чувствительность из опций');
    eq($.camera.mouseLook(), false, 'опции без on состояние не меняют');
});

test('re2dViewOf: зум сужает угол обзора, а не масштабирует кадр', () => {
    reset();
    const base = { x: 5, y: 6, eye: 40, yaw: 0.3, pitch: 0.1, fov: 90 * DEG, zoom: 1, w: 800, h: 600, shake_x: 0, shake_y: 0 };
    const v1 = re2dViewOf(base);
    near(v1.fov, 90 * DEG, 1e-9, 'zoom 1 — fov как задан');
    const v2 = re2dViewOf({ ...base, zoom: 2 });
    near(Math.tan(v2.fov / 2), Math.tan(45 * DEG) / 2, 1e-9, 'zoom 2 — тангенс половины угла вдвое меньше');
    eq(v1.x, 5); eq(v1.y, 6); eq(v1.eye, 40);
    near(v1.yaw, 0.3, 1e-12, 'yaw из состояния камеры');
});

test('re2dViewOf: тряска — небольшой поворот в нужную сторону', () => {
    const base = { x: 0, y: 0, eye: 40, yaw: 0, pitch: 0, fov: 90 * DEG, zoom: 1, w: 800, h: 600 };
    const shakeRight = re2dViewOf({ ...base, shake_x: 30, shake_y: 0 });
    truthy(shakeRight.yaw < 0, 'картинка сдвинулась вправо → камера довернула влево');
    const shakeDown = re2dViewOf({ ...base, shake_x: 0, shake_y: 30 });
    truthy(shakeDown.pitch > 0, 'картинка сдвинулась вниз → камера подняла взгляд');
    const clamped = re2dViewOf({ ...base, pitch: 1.5, shake_x: 0, shake_y: 300 });
    truthy(clamped.pitch <= 85 * DEG + 1e-9, 'pitch с тряской не выходит за ±85°');
});

test('cameraTransform несёт поля вида', () => {
    reset();
    $.camera.kind(Re2D).pitch(10).eye(60).fov(80).fog(500, 0.4);
    const t = cameraTransform();
    eq(t.kind, 're2d', 'kind');
    near(t.pitch, 10 * DEG, 1e-9, 'pitch в радианах');
    eq(t.eye, 60, 'eye');
    near(t.fov, 80 * DEG, 1e-9, 'fov в радианах');
    eq(t.fogFar, 500, 'fogFar');
    near(t.fogMin, 0.4, 1e-12, 'fogMin');
});

test('снимок и восстановление переносят вид; старый снимок даёт умолчания', () => {
    reset();
    $.camera.kind(Re2D).yaw(45).pitch(-20).eye(70).fov(90).fog(300, 0.5);
    const snap = $.camera.snapshot();
    $.camera.kind(null).yaw(0).pitch(0).eye(10).fov(40).fog(0);
    $.camera.restore(snap);
    eq($.camera.kind(), 're2d', 'вид');
    near($.camera.yaw(), 45, 1e-6, 'yaw'); near($.camera.pitch(), -20, 1e-6, 'pitch');
    eq($.camera.eye(), 70, 'eye'); near($.camera.fov(), 90, 1e-6, 'fov');
    eq($.camera.fog().far, 300, 'fog');

    // Снимок прошлой версии (до Re2D): поля вида отсутствуют.
    $.camera.restore({ x: 10, y: 20, zoom: 1.5, rotation: 0.2, offset: { x: 0, y: 0 }, smooth: 0 });
    eq($.camera.kind(), '2d', 'без kind — 2D');
    eq($.camera.eye(), 48, 'eye по умолчанию');
    near($.camera.fov(), 70, 1e-6, 'fov по умолчанию');
    eq($.camera.pos().x, 10, 'старые поля восстановлены');
});

test('info() — факты структурой, углы в градусах', () => {
    reset();
    $.camera.kind(Re2D).at(100, 200).yaw(30).pitch(15).eye(52).fov(75);
    const info = $.camera.info();
    eq(info.kind, 're2d'); eq(info.x, 100); eq(info.y, 200); eq(info.eye, 52);
    near(info.yaw, 30, 1e-6); near(info.pitch, 15, 1e-6); near(info.fov, 75, 1e-6);
    eq(info.mouseLook, false);
});

test('2D не тронут: границы limits действуют в 2D и не мешают в Re2D', () => {
    reset();
    $.camera.limits(0, 0, 400, 300).at(-1000, -1000);
    truthy($.camera.pos().x >= 0, `2D: камера зажата границами (${$.camera.pos().x})`);
    $.camera.kind(Re2D).at(-1000, -1000);
    eq($.camera.pos().x, -1000, 'Re2D: границы 2D-кадра не применяются');
});

test('слежение: в 2D сглаженное, в Re2D мгновенное', () => {
    reset();
    $('<npc>', { id: 'hero' }).at(1000, 500);
    $.camera.at(0, 0).follow('#hero');
    $.camera._tick(1 / 60);
    truthy($.camera.pos().x > 0 && $.camera.pos().x < 1000, `2D: плавно подтягивается (${$.camera.pos().x})`);
    $.camera.unfollow().at(0, 0).kind(Re2D).follow('#hero');
    $.camera._tick(1 / 60);
    eq($.camera.pos().x, 1000, 'Re2D: глаза сразу на теле');
    eq($.camera.pos().y, 500, 'Re2D: и по y');
});

test('_tick поворачивает камеру на сдвиг мыши, только в Re2D и при mouseLook', () => {
    reset();
    engine.mouseDelta = () => [40, -20];
    $.camera.mouseLook({ on: true, sensitivity: 0.01 });
    $.camera._tick(1 / 60);
    eq($.camera.yaw(), 0, '2D-камера мышью не вращается');
    $.camera.kind(Re2D);
    $.camera._tick(1 / 60);
    near($.camera.yaw(), 0.4 / DEG, 1e-9, 'Re2D: yaw += 40 × 0.01 рад');
    near($.camera.pitch() * DEG, 0.2, 1e-9, 'Re2D: pitch поднят на 20 × 0.01');
    $.camera.mouseLook(false);
    $.camera._tick(1 / 60);
    near($.camera.yaw(), 0.4 / DEG, 1e-9, 'без mouseLook кадр ничего не добавляет');
    delete engine.mouseDelta;
});

test('worldToScreen/screenToWorld/isOnScreen в Re2D идут через нативное ядро', () => {
    reset();
    $.camera.kind(Re2D).at(10, 20).yaw(10).pitch(5).eye(40).fov(80);
    $('<npc>', { id: 'n1' }).at(300, 400).kind(Re2D);
    $('#n1').depth(25);
    const p = $.camera.worldToScreen('#n1');
    eq(p.x, 300, 'x из заглушки'); eq(p.y, 400, 'y из заглушки');
    eq(p.visible, true, 'видимая точка');
    eq(p.scale, 2, 'масштаб из нативного ядра');
    const last = calls.view[calls.view.length - 1];
    eq(last[0], 10, 'вид: x'); eq(last[1], 20, 'вид: y'); eq(last[2], 40, 'вид: eye');
    near(last[3], 10 * DEG, 1e-9, 'вид: yaw'); near(last[4], 5 * DEG, 1e-9, 'вид: pitch'); near(last[5], 80 * DEG, 1e-9, 'вид: fov');
    const floor = $.camera.screenToWorld({ x: 100, y: 200 });
    eq(floor.x, 101, 'screenToWorld → unproject.x'); eq(floor.y, 202, 'screenToWorld → unproject.y');
    eq(calls.unproject[0][2], 0, 'по умолчанию — плоскость пола');
    truthy($.camera.isOnScreen({ x: 300, y: 400 }) === false || true, 'isOnScreen не бросает');

    // 2D-камера по-прежнему отдаёт {x, y} без полей вида.
    $.camera.kind(null);
    const flat = $.camera.worldToScreen({ x: 10, y: 20 });
    falsy('visible' in flat, '2D: результат прежней формы');
});

test('проход вида: регистрация проверяет форму и вид', () => {
    let message = '';
    try { registerKindPass('re2d', { begin() {} }); } catch (error) { message = String(error.message); }
    truthy(message.includes('begin(cam), end(cam)'), `нужны begin и end: ${message}`);
    message = '';
    try { registerKindPass('ghost', { begin() {}, end() {} }); } catch (error) { message = String(error.message); }
    truthy(message.includes('не зарегистрирован'), `вид должен существовать: ${message}`);
    truthy(typeof kindPass('re2d').begin === 'function', 'проход re2d поставлен модулем re2d.js');
    eq(kindPass('2d'), undefined, 'у 2D прохода нет — рисует обычный путь');
});

test('проход re2d.begin ставит нативный вид по камере', () => {
    reset();
    $.camera.kind(Re2D).at(7, 8).eye(33).yaw(20).fov(60).zoom(1);
    kindPass('re2d').begin(cameraTransform());
    const last = calls.view[calls.view.length - 1];
    eq(last[0], 7); eq(last[1], 8); eq(last[2], 33);
    near(last[5], 60 * DEG, 1e-9, 'fov без зума');
});

test('$.re2d.info: камера и счётчики ядра', () => {
    reset();
    const info = $.re2d.info();
    truthy(info.camera && info.native, 'обе части на месте');
    eq(info.camera.kind, '2d', 'вид камеры');
});

finish();
