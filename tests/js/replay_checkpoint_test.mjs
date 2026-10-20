// ===========================================================================
// Именованные checkpoints реплея (src/highlevel/replay.js).
//
// §27 FINAL ENGINE PASS: replay уже умел periodic hash каждые N tick. Для
// регресс-тестов и баг-репортов нужна точка с ИМЕНЕМ ("after_boss"), которую
// можно сравнить с ожидаемым hash и получить точный кадр расхождения.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/replay_checkpoint_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createReplay, hashOfValues } from '../../src/highlevel/replay.js';

/** Мир с изменяемым gameplay-состоянием; hash считается тем же ядром. */
function world() {
    const state = { labels: ['hero.hp', 'hero.x', 'boss.hp'], values: [100, 10, 50] };
    const hooks = { stateSnapshot: () => ({ labels: state.labels.slice(), values: state.values.slice() }) };
    return { state, hooks };
}

test('checkpoint: снимается на указанном кадре записи и хранит hash', () => {
    const w = world();
    const r = createReplay({ seed: 1, dt: 1 / 60 }, w.hooks);
    r.start();
    r.checkpoint('after_boss', { frame: 2 });
    r.record({ a: 1 }, 0);
    w.state.values[2] = 0;                    // босс умер
    r.record({ a: 2 }, 1);
    w.state.values[2] = -1;
    r.record({ a: 3 }, 2);
    r.stop();

    const named = r.namedCheckpoints();
    eq(named.length, 1, 'один именованный checkpoint');
    eq(named[0].name, 'after_boss');
    eq(named[0].tick, 2);
    const entry = r.checkpointNamed('after_boss');
    truthy(entry, 'checkpointNamed находит запись');
    eq(entry.values[2], -1, 'снимок именно кадра 2');
    eq(entry.hash, hashOfValues([100, 10, -1]), 'hash по стабильным полям');
});

test('checkpoint: hash совпадает с состоянием на том же кадре', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('now');
    r.record({}, 0);
    r.stop();
    const c = r.checkpointNamed('now');
    eq(c.tick, 0);
    eq(c.hash, hashOfValues(w.state.values));
});

test('verifyCheckpoint: расхождение показывает кадр, имя и поля', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('after_boss', { frame: 0 });
    r.record({}, 0);
    r.stop();
    w.state.values[0] = 35;                   // hp уехал
    const v = r.verifyCheckpoint('after_boss');
    eq(v.ok, false);
    eq(v.checkpoint, 'after_boss', 'имя в расхождении');
    eq(v.tick, 0);
    truthy(v.fields.length >= 1, 'есть diff полей');
    const hp = v.fields.find((f) => f.field === 'hero.hp');
    truthy(hp, 'поле hero.hp в diff');
    eq(hp.expected, 100);
    eq(hp.actual, 35);
});

test('verifyCheckpoint: совпавшее состояние — ok', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('same', { frame: 0 });
    r.record({}, 0);
    r.stop();
    const v = r.verifyCheckpoint('same');
    eq(v.ok, true);
    eq(v.checkpoint, 'same');
});

test('verifyState: именованный checkpoint проверяется и без every', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('t1', { frame: 1 });
    r.record({}, 0);
    r.record({}, 1);
    r.stop();
    r.checkpoints({ every: 0 });
    eq(r.verifyState(1).ok, true, 'состояние прежнее — ok');
    w.state.values[1] = 999;
    r.checkpoints({ every: 0 });
    const v = r.verifyState(1);
    eq(v.ok, false);
    eq(v.checkpoint, 't1', 'расхождение привязано к имени');
});

test('checkpoint с ожидаемым hash: расхождение видно сразу при записи', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('ci', { frame: 0, hash: 'deadbeef' });
    r.record({}, 0);
    const d = r.divergence();
    truthy(d, 'расхождение зафиксировано');
    eq(d.checkpoint, 'ci');
    eq(d.expected, 'deadbeef');
    eq(d.actual, hashOfValues(w.state.values));
});

test('checkpoint: повторное имя не создаёт дубль и не сдвигает снимок', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('once', { frame: 0 });
    r.record({}, 0);
    r.checkpoint('once', { frame: 1 });
    r.record({}, 1);
    r.stop();
    eq(r.namedCheckpoints().length, 1);
    eq(r.checkpointNamed('once').tick, 0);
});

test('toText/load: именованные checkpoints переживают round-trip', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.checkpoint('after_boss', { frame: 0 });
    r.record({}, 0);
    r.stop();
    const text = r.toText();
    const copy = createReplay({}, w.hooks);
    truthy(copy.load(text), 'реплей загружен');
    const c = copy.checkpointNamed('after_boss');
    truthy(c, 'имя после загрузки');
    eq(c.hash, r.checkpointNamed('after_boss').hash);
    eq(c.tick, 0);
    eq(copy.verifyCheckpoint('after_boss').ok, true);
});

test('checkpoint: кадр уже позади — запись не выдумывается', () => {
    const w = world();
    const r = createReplay({}, w.hooks);
    r.start();
    r.record({}, 0);
    r.record({}, 1);
    r.checkpoint('late', { frame: 0 });
    r.stop();
    eq(r.namedCheckpoints().length, 0, 'checkpoint на прошедший кадр не снят');
});

test('checkpoint: без ссылки на состояние возвращает replay, не бросает', () => {
    const r = createReplay({});
    r.start();
    truthy(r.checkpoint('x', { frame: 0 }) === r, 'цепочка сохранена');
    r.record({}, 0);
    r.stop();
    eq(r.namedCheckpoints().length, 0);
});

finish();
