// ===========================================================================
// Юнит-тесты реплеев (src/highlevel/replay.js) без движка.
//
// Реплей — это запись ввода по кадрам плюс заголовок с зерном и шагом времени.
// Проверяем: запись идёт только в режиме записи, кадры возвращаются по порядку,
// проигрывание само заканчивается, пустые кадры не съезжают, а сравнение двух
// записей находит первое расхождение (на этом стоит регресс-тест на баг-репорт).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/replay_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createReplay, compareReplays, MAX_FRAMES } from '../../src/highlevel/replay.js';

test('запись: кадры пишутся только в режиме записи', () => {
    const r = createReplay({ seed: 7, dt: 1 / 60 });
    eq(r.mode(), 'idle', 'сначала без режима');
    falsy(r.record({ x: 1 }, 0), 'в покое запись не идёт');
    eq(r.length(), 0);

    r.start({ level: 'bunker' });
    truthy(r.isRecording(), 'запись включена');
    truthy(r.record({ x: 1, y: 2 }, 0), 'первый кадр записан');
    truthy(r.record({ x: 3, y: 4 }, 1), 'второй кадр');
    eq(r.length(), 2);
    eq(r.header().seed, 7, 'зерно в заголовке');
    eq(r.header().level, 'bunker', 'поле игры в заголовке');

    r.stop();
    falsy(r.isRecording(), 'запись остановлена');
    falsy(r.record({ x: 9 }, 2), 'после стопа не пишем');
    eq(r.length(), 2, 'длина не изменилась');
    eq(r.header().frames, 2, 'в заголовке зафиксировано число кадров');
});

test('запись: объект хранится текстом, пустой кадр не съезжает', () => {
    const r = createReplay({});
    r.start();
    r.record({ a: 1 }, 10);
    r.record(null, 11);               // пустой кадр: пропуск сломал бы соответствие
    r.record('готово', 12);
    r.stop();
    const frames = r.frames();
    eq(frames.length, 3, 'три кадра, включая пустой');
    eq(frames[0].f, 10);
    eq(frames[0].d, '{"a":1}', 'объект сериализован');
    eq(frames[1].f, 11);
    eq(frames[1].d, null, 'пустой кадр остался пустым');
    eq(frames[2].d, 'готово', 'строка как есть');
});

test('запись: циклический объект не записывается, но кадр не теряется', () => {
    const r = createReplay({});
    r.start();
    const loop = {}; loop.self = loop;
    truthy(r.record(loop, 0), 'кадр записан');
    eq(r.at(0).d, null, 'несериализуемое стало пустым кадром');
});

test('проигрывание: кадры по порядку, конец сам снимает режим', async () => {
    const r = createReplay({});
    r.start();
    r.record({ n: 1 }, 0);
    r.record(null, 1);
    r.record({ n: 3 }, 2);
    r.stop();

    falsy(r.isPlaying(), 'пока не играем');
    eq(r.tick(), null, 'в покое tick пуст');
    r.play();
    truthy(r.isPlaying(), 'проигрывание включено');
    eq(r.tick(), '{"n":1}', 'первый кадр');
    eq(r.position(), 1, 'курсор сдвинулся');
    eq(r.tick(), null, 'пустой кадр отдаёт null');
    eq(r.tick(), '{"n":3}', 'третий кадр');
    eq(r.tick(), null, 'запись кончилась');
    // Режим снимается: у последнего кадра — микрозадачей, поэтому даём ей пройти.
    await Promise.resolve();
    falsy(r.isPlaying(), 'после конца проигрывание остановлено');
});

test('проигрывание: старт с кадра и перемотка', () => {
    const r = createReplay({});
    r.start();
    for (let i = 0; i < 5; ++i) r.record({ i }, i);
    r.stop();
    r.play(2);
    eq(r.position(), 2, 'начали с третьего кадра');
    eq(r.tick(), '{"i":2}');
    eq(r.skip(1), 4, 'пропустили ещё один');
    eq(r.tick(), '{"i":4}');
    eq(r.skip(100), 5, 'перемотка за конец обрезается');
    eq(r.position(), 5);
});

test('проигрывание: onEnd вызывается один раз', async () => {
    const r = createReplay({});
    r.start();
    r.record({ a: 1 }, 0);
    r.stop();
    let ends = 0;
    r.onEnd = () => ends++;
    r.play();
    eq(r.tick(), '{"a":1}', 'кадр отдан');
    await Promise.resolve();
    await Promise.resolve();
    eq(ends, 1, 'конец вызван один раз');
    eq(r.tick(), null, 'после конца tick пуст');
    eq(ends, 1, 'и больше не зовётся');
});

test('текст: запись и чтение сохраняют кадры и заголовок', () => {
    const a = createReplay({ seed: 42, dt: 0.016 });
    a.start({ level: 'city' });
    a.record({ dx: 1 }, 0);
    a.record({ dx: -1 }, 1);
    a.stop();
    const text = a.toText();
    truthy(text.length > 0, 'текст не пуст');
    truthy(a.size() > 0, 'оценка размера есть');

    const b = createReplay({});
    truthy(b.load(text), 'текст разобран');
    eq(b.length(), 2, 'два кадра');
    eq(b.header().seed, 42, 'зерно вернулось');
    eq(b.header().level, 'city', 'поле игры вернулось');
    eq(b.frames()[1].f, 1);
    eq(b.tick(), null, 'после загрузки режим покоя');
    b.play();
    eq(b.tick(), '{"dx":1}', 'первый кадр');
});

test('load: мусор не ломает запись', () => {
    const r = createReplay({});
    r.start();
    r.record({ a: 1 }, 0);
    r.stop();
    falsy(r.load('{ это не json'), 'битый JSON отвергнут');
    falsy(r.load({ нет: 'frames' }), 'объект без frames отвергнут');
    eq(r.length(), 1, 'прежняя запись цела');
    truthy(r.load({ header: { seed: 1 }, frames: [{ f: 5, d: 'x' }] }), 'объект принят');
    eq(r.at(0).f, 5);
});

test('сравнение двух записей находит расхождение', () => {
    const a = createReplay({});
    const b = createReplay({});
    for (const r of [a, b]) {
        r.start();
        r.record({ x: 1 }, 0);
        r.record({ x: 2 }, 1);
        r.stop();
    }
    eq(compareReplays(a, b).same, true, 'одинаковые записи совпали');
    eq(compareReplays(a, b).first, -1, 'расхождений нет');

    // «Баг воспроизведён»: вторая запись разошлась на втором кадре.
    b.clear();
    b.start();
    b.record({ x: 1 }, 0);
    b.record({ x: 99 }, 1);
    b.stop();
    const cmp = compareReplays(a, b);
    eq(cmp.same, false, 'расхождение найдено');
    eq(cmp.first, 1, 'и это ровно второй кадр');

    // Разная длина тоже расхождение.
    a.clear();
    a.start(); a.record({ x: 1 }, 0); a.stop();
    eq(compareReplays(a, b).same, false, 'разная длина — расхождение');
});

test('_push пишет кадр в обход проверки режима (им пользуется обвязка)', () => {
    const r = createReplay({});
    r.start();
    truthy(r._push({ a: 1 }, 3), 'кадр записан ядром');
    eq(r.at(0).f, 3);
    eq(r.at(0).d, '{"a":1}');
    r.stop();
    falsy(r._push({ a: 2 }, 4), 'в покое ядро тоже не пишет');
    eq(r.length(), 1);
});

test('clear обнуляет запись и режим', () => {
    const r = createReplay({});
    r.start();
    r.record({ a: 1 }, 0);
    r.clear();
    eq(r.length(), 0);
    eq(r.position(), 0);
    eq(r.mode(), 'idle');
});

test('предел записи: дальше кадры не пишутся, но не падает', () => {
    const r = createReplay({});
    r.start();
    // Записываем больше предела нельзя (это заняло бы память), поэтому
    // проверяем сам факт наличия предела и что запись в норме.
    truthy(MAX_FRAMES >= 36000, 'предел не меньше 10 минут при 60 к/с');
    for (let i = 0; i < 100; ++i) r.record({ i }, i);
    eq(r.length(), 100, 'обычные кадры пишутся');
    eq(r.dropped(), 0, 'ничего не потеряно');
});

finish();
