// ===========================================================================
// Тайминги встроенного управления (.controls): coyote time, jump buffer,
// переменная высота прыжка (jump cut), воздушные прыжки и спрыгивание с
// односторонней платформы.
//
// Проверяется чистая логика (src/highlevel/api.js: controlsScheme,
// makeControlsState, controlsTimingStep) — без движка и без физики. Главное
// свойство: окна считаются игровым ВРЕМЕНЕМ, а не кадрами, поэтому один и тот
// же тест проходит и при dt = 1/60, и при dt = 1/120.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/controls_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { controlsScheme, makeControlsState, controlsTimingStep } from '../../src/highlevel/api.js';

const DT = 1 / 60;

/** Один шаг: возвращает решение функции и обновляет состояние на месте. */
function step(state, s, input, dt) {
    return controlsTimingStep(state, s, dt === undefined ? DT : dt, Object.assign({
        pressed: false, released: false, down: false, grounded: false, oneWay: false, vy: 0,
    }, input));
}

// --- Схема и умолчания ------------------------------------------------------

test('controlsScheme: строка — прежнее поведение', () => {
    const s = controlsScheme('both');
    eq(s.axis, 'both', 'ось');
    eq(s.jump_key, 'space', 'клавиша прыжка');
    eq(s.up_key, 'w', 'клавиша «вверх»');
    eq(s.coyote, 0, 'coyote по умолчанию выключен');
    eq(s.jump_buffer, 0, 'буфер прыжка по умолчанию выключен');
    eq(s.jump_cut, 0, 'обрезка прыжка по умолчанию выключена');
    eq(s.air_jumps, 0, 'воздушных прыжков по умолчанию нет');
    eq(s.drop, true, 'спрыгивание включено');
    eq(s.drop_keys.join(','), 's,down', 'низ — S и ↓ для «both»');
});

test('controlsScheme: клавиши спрыгивания зависят от раскладки', () => {
    eq(controlsScheme('wasd').drop_keys.join(','), 's');
    eq(controlsScheme('arrows').drop_keys.join(','), 'down');
});

test('controlsScheme: настройки в миллисекундах → секунды', () => {
    const s = controlsScheme({
        axis: 'wasd', jump: 'space', up: 'up',
        coyote: 100, jumpBuffer: 120, jumpCut: 0.4, airJump: 2, dropTime: 300,
    });
    near(s.coyote, 0.1, 1e-9, 'coyote 100 мс');
    near(s.jump_buffer, 0.12, 1e-9, 'буфер 120 мс');
    near(s.jump_cut, 0.4, 1e-9, 'множитель обрезки');
    eq(s.air_jumps, 2, 'два воздушных прыжка');
    near(s.drop_time, 300, 1e-9, 'окно спрыгивания');
});

test('controlsScheme: jumpCut true — короткий прыжок 0.35, мусор — выключено', () => {
    near(controlsScheme({ jumpCut: true }).jump_cut, 0.35, 1e-9);
    eq(controlsScheme({ jumpCut: 1 }).jump_cut, 0, 'множитель 1 ничего не режет');
    eq(controlsScheme({ jumpCut: 2 }).jump_cut, 0, 'множитель > 1 отбрасывается');
    eq(controlsScheme({ jumpCut: 'нет' }).jump_cut, 0, 'нечисло отбрасывается');
});

test('controlsScheme: dropThrough false выключает спрыгивание', () => {
    eq(controlsScheme({ dropThrough: false }).drop, false);
});

// --- Базовый прыжок ---------------------------------------------------------

test('нажатие на земле прыгает сразу (буфер 0)', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    const r = step(st, s, { pressed: true, grounded: true });
    eq(r.jump, true, 'прыжок');
    eq(r.air, false, 'это не воздушный прыжок');
    eq(r.drop, false, 'не спрыгивание');
});

test('без нажатия прыжка нет', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    eq(step(st, s, { grounded: true }).jump, false);
});

// --- Coyote time ------------------------------------------------------------

test('coyote: прыжок через 80 мс после схода — есть, через 200 мс — нет', () => {
    const s = controlsScheme({ coyote: 150 });
    const st = makeControlsState();
    // 5 кадров на земле: фора обновляется каждый кадр.
    for (let i = 0; i < 5; i++) step(st, s, { grounded: true });
    // Сход с платформы: 5 кадров в воздухе ≈ 83 мс — внутри форы.
    for (let i = 0; i < 5; i++) step(st, s, { grounded: false, vy: 20 });
    eq(step(st, s, { pressed: true, grounded: false, vy: 40 }).jump, true,
       'прыжок в пределах coyote');

    const st2 = makeControlsState();
    for (let i = 0; i < 5; i++) step(st2, s, { grounded: true });
    for (let i = 0; i < 12; i++) step(st2, s, { grounded: false, vy: 20 });   // 200 мс
    eq(step(st2, s, { pressed: true, grounded: false, vy: 40 }).jump, false,
       'после истечения форы прыжка нет');
});

test('coyote: форы нет, если схема её не включает', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    step(st, s, { grounded: true });
    step(st, s, { grounded: false });
    eq(step(st, s, { pressed: true, grounded: false }).jump, false,
       'без coyote прыжок в воздухе не работает');
});

test('coyote: окно меряется временем, а не кадрами', () => {
    const s = controlsScheme({ coyote: 100 });
    // При dt = 1/120 то же «80 мс в воздухе» — это 10 кадров, и прыжок обязан работать.
    const st = makeControlsState();
    const dt = 1 / 120;
    for (let i = 0; i < 10; i++) step(st, s, { grounded: true }, dt);
    for (let i = 0; i < 9; i++) step(st, s, { grounded: false, vy: 20 }, dt);   // 75 мс
    eq(step(st, s, { pressed: true, grounded: false, vy: 40 }, dt).jump, true,
       'при 120 Гц окно то же, что при 60 Гц');
});

// --- Jump buffer ------------------------------------------------------------

test('буфер: нажатие в воздухе срабатывает при касании земли', () => {
    const s = controlsScheme({ jumpBuffer: 150 });
    const st = makeControlsState();
    // Нажали в падении, за ~100 мс до земли.
    eq(step(st, s, { pressed: true, grounded: false, vy: 300 }).jump, false,
       'сразу после нажатия прыжка нет — земли ещё нет');
    for (let i = 0; i < 5; i++) step(st, s, { grounded: false, vy: 400 });   // 83 мс
    const r = step(st, s, { grounded: true, vy: 0 });
    eq(r.jump, true, 'приземлились — буфер сработал');
    eq(r.air, false, 'это обычный прыжок от земли');
    // Буфер израсходован: без нового нажатия повторного прыжка нет.
    eq(step(st, s, { grounded: true, vy: -100 }).jump, false, 'буфер не повторяется');
});

test('буфер: истёкшее нажатие не срабатывает', () => {
    const s = controlsScheme({ jumpBuffer: 100 });
    const st = makeControlsState();
    step(st, s, { pressed: true, grounded: false });
    for (let i = 0; i < 12; i++) step(st, s, { grounded: false });   // 200 мс
    eq(step(st, s, { grounded: true }).jump, false, 'окно прошло — прыжка нет');
});

test('буфер: приземление через кадр после нажатия — прыжок', () => {
    const s = controlsScheme({ jumpBuffer: 120 });
    const st = makeControlsState();
    step(st, s, { pressed: true, grounded: false, vy: 500 });
    eq(step(st, s, { grounded: true }).jump, true, 'буфер дожил до земли');
});

// --- Переменная высота ------------------------------------------------------

test('jump cut: отпустил на подъёме — прыжок обрезан', () => {
    const s = controlsScheme({ jumpCut: 0.35 });
    const st = makeControlsState();
    step(st, s, { pressed: true, grounded: true });
    const r = step(st, s, { released: true, vy: -500 });   // ещё поднимаемся
    near(r.cut, 0.35, 1e-9, 'множитель обрезки');
});

test('jump cut: отпустил в падении — скорость падения не режется', () => {
    const s = controlsScheme({ jumpCut: 0.35 });
    const st = makeControlsState();
    step(st, s, { pressed: true, grounded: true });
    step(st, s, { vy: -100 });          // прыжок завершился: тело падает
    eq(step(st, s, { released: true, vy: 300 }).cut, 0, 'падение не обрезается');
});

test('jump cut: тап (нажал и отпустил в одном кадре) — короткий прыжок', () => {
    const s = controlsScheme({ jumpCut: 0.35 });
    const st = makeControlsState();
    const r = step(st, s, { pressed: true, released: true, grounded: true });
    eq(r.jump, true, 'прыжок есть');
    near(r.cut, 0.35, 1e-9, 'и сразу обрезан');
});

test('jump cut: без настройки отпускание ничего не делает', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    step(st, s, { pressed: true, grounded: true });
    eq(step(st, s, { released: true, vy: -500 }).cut, 0);
});

// --- Повторный прыжок и «залипание» ----------------------------------------

test('удержание кнопки не даёт повторного прыжка на земле', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    eq(step(st, s, { pressed: true, grounded: true }).jump, true, 'первый прыжок');
    // Кнопка удерживается: pressed больше не приходит, тело летит и садится.
    let repeats = 0;
    for (let i = 0; i < 60; i++) {
        if (step(st, s, { grounded: i > 40, vy: i > 40 ? 0 : -100 }).jump) repeats++;
    }
    eq(repeats, 0, 'на земле с зажатой кнопкой повторных прыжков нет');
    // Отпустили и нажали снова — прыжок снова возможен.
    step(st, s, { released: true, grounded: true });
    eq(step(st, s, { pressed: true, grounded: true }).jump, true, 'новое нажатие прыгает');
});

test('air jump: один воздушный прыжок, потом только земля', () => {
    const s = controlsScheme({ airJump: 1 });
    const st = makeControlsState();
    step(st, s, { grounded: true });
    step(st, s, { grounded: false, vy: 100 });
    const r1 = step(st, s, { pressed: true, grounded: false, vy: 100 });
    eq(r1.jump, true, 'воздушный прыжок');
    eq(r1.air, true, 'помечен как воздушный');
    step(st, s, { grounded: false, vy: 100 });
    eq(step(st, s, { pressed: true, grounded: false, vy: 100 }).jump, false,
       'второго воздушного прыжка нет');
    // Земля возвращает запас.
    step(st, s, { grounded: true });
    eq(step(st, s, { grounded: false }).jump, false, 'сразу после земли нажатия не было');
    eq(step(st, s, { pressed: true, grounded: false }).air, true, 'запас восстановлен');
});

test('air jump: без настройки прыжок в воздухе запрещён', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    step(st, s, { grounded: true });
    step(st, s, { grounded: false });
    eq(step(st, s, { pressed: true, grounded: false }).jump, false);
});

test('прыжок после схода с земли без coyote не «залипает» у стены', () => {
    // У стены тело не проходит луч вниз: grounded=false, значит и прыжка нет,
    // пока не включена coyote-фора или воздушный прыжок.
    const s = controlsScheme('both');
    const st = makeControlsState();
    for (let i = 0; i < 10; i++) {
        eq(step(st, s, { pressed: true, grounded: false, vy: 50 }).jump, false,
           'нажатие у стены не даёт прыжка');
    }
});

// --- Спрыгивание с односторонней платформы ---------------------------------

test('drop: S+Space на односторонней платформе — вниз, а не вверх', () => {
    const s = controlsScheme({ axis: 'both' });
    const st = makeControlsState();
    const r = step(st, s, { pressed: true, down: true, grounded: true, oneWay: true });
    eq(r.drop, true, 'спрыгивание');
    eq(r.jump, false, 'прыжка вверх нет');
    // Нажатие израсходовано: следующее приземление не прыгает само.
    eq(step(st, s, { pressed: false, grounded: false }).jump, false);
});

test('drop: S+Space на обычной земле — обычный прыжок', () => {
    const s = controlsScheme({ axis: 'both' });
    const st = makeControlsState();
    const r = step(st, s, { pressed: true, down: true, grounded: true, oneWay: false });
    eq(r.drop, false, 'спрыгивания нет');
    eq(r.jump, true, 'прыжок вверх');
});

test('drop: Space без «вниз» на односторонней платформе — прыжок вверх', () => {
    const s = controlsScheme('both');
    const st = makeControlsState();
    const r = step(st, s, { pressed: true, grounded: true, oneWay: true });
    eq(r.drop, false);
    eq(r.jump, true);
});

test('drop: dropThrough false не спрыгивает', () => {
    const s = controlsScheme({ dropThrough: false });
    const st = makeControlsState();
    const r = step(st, s, { pressed: true, down: true, grounded: true, oneWay: true });
    eq(r.drop, false);
    eq(r.jump, true, 'вместо спрыгивания — обычный прыжок');
});

finish();
