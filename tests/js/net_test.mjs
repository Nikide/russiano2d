// ===========================================================================
// Юнит-тесты сети (src/highlevel/net.js) — ТОЛЬКО авторитарная модель.
//
// Проверяем то, что легко сломать: стабильные сетевые id, владение узлами,
// снапшоты с дельтой и удалением, интерполяцию чужих, очередь ввода с номерами,
// и главное — инвариант «клиент не пишет авторитетное».
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/net_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    createIdTable, diffSnapshot, applySnapshot, interpolate, sameValue,
    createInputQueue, createAuthority, createClientState,
} from '../../src/highlevel/net.js';
import { createApi } from '../../src/highlevel/api.js';

/** Узел-заглушка: сеть работает с любыми объектами. */
function fakeNode(x, y, hp) {
    return {
        tag: 'node',
        pos() { return { x: this._x, y: this._y }; },
        get(name) { return name === 'hp' ? this._hp : undefined; },
        _x: x, _y: y, _hp: hp,
    };
}

test('стол id: номер один на узел и не переиспользуется', () => {
    const ids = createIdTable('e');
    const a = fakeNode(1, 2, 3);
    const b = fakeNode(4, 5, 6);
    const idA = ids.idOf(a);
    eq(idA, 1, 'первый узел — первый номер');
    eq(ids.idOf(a), idA, 'тот же узел — тот же номер');
    const idB = ids.idOf(b);
    truthy(idB !== idA, 'разные узлы — разные номера');
    eq(ids.nodeOf(idB), b, 'обратный поиск');
    eq(ids.size(), 2);
    eq(ids.key(idA), 'e1');
    eq(ids.parse('e1'), 1);
    eq(ids.parse('чушь'), 0);
    // Освобождённый номер больше не выдаётся.
    eq(ids.remove(b), idB);
    eq(ids.has(idB), false);
    const c = fakeNode(7, 8, 9);
    truthy(ids.idOf(c) > idB, 'новый номер не переиспользует старый');
});

test('дельта снапшота: только изменившиеся поля', () => {
    const base = { tick: 1, entities: { e1: { x: 10, y: 20, hp: 100 }, e2: { x: 0, y: 0, hp: 50 } } };
    const now = { entities: { e1: { x: 10.5, y: 20, hp: 100 }, e2: { x: 0, y: 0, hp: 50 } } };
    const delta = diffSnapshot(base, now, 2);
    eq(delta.tick, 2);
    eq(delta.full, false, 'это дельта, а не полный снапшот');
    eq(Object.keys(delta.entities).join(','), 'e1', 'изменился только один узел');
    eq(Object.keys(delta.entities.e1).join(','), 'x', 'только поле x');
    near(delta.entities.e1.x, 10.5, 1e-9);
    eq(delta.changed, 1);
    // Ничего не изменилось — пустая дельта.
    const empty = diffSnapshot(now, now, 3);
    eq(Object.keys(empty.entities).length, 0);
    eq(empty.changed, 0);
});

test('дельта: новый узел целиком, удалённый — null', () => {
    const base = { tick: 1, entities: { e1: { x: 1, y: 1 } } };
    const now = { entities: { e2: { x: 5, y: 5 } } };
    const delta = diffSnapshot(base, now, 2);
    eq(Object.keys(delta.entities).sort().join(','), 'e1,e2');
    eq(delta.entities.e2.x, 5, 'новый узел приходит целиком');
    eq(delta.entities.e1, null, 'удалённый помечен null');
    // Первый снапшот — полный.
    const full = diffSnapshot(null, now, 2);
    eq(full.full, true);
    eq(Object.keys(full.entities).join(','), 'e2');
});

test('sameValue: числа с допуском, массивы поэлементно', () => {
    truthy(sameValue(1, 1.00001), 'мелкое дрожание прощаем');
    falsy(sameValue(1, 1.5));
    truthy(sameValue([1, 2], [1, 2]));
    falsy(sameValue([1, 2], [1, 3]));
    falsy(sameValue([1], [1, 2]));
    truthy(sameValue('идёт', 'идёт'));
    falsy(sameValue('идёт', 'стоит'));
    truthy(sameValue(null, null));
});

test('applySnapshot: патчи поверх, удаления исчезают, вход не меняется', () => {
    const state = { tick: 1, entities: { e1: { x: 1, y: 2, hp: 100 }, e2: { x: 9 } } };
    const snapshot = { tick: 5, entities: { e1: { x: 3 }, e2: null, e3: { x: 0 } } };
    const out = applySnapshot(state, snapshot);
    eq(out.tick, 5);
    eq(out.entities.e1.x, 3);
    eq(out.entities.e1.y, 2, 'не переданные поля сохраняются');
    eq(out.entities.e1.hp, 100);
    eq(out.entities.e2, undefined, 'удалённый узел исчез');
    truthy(out.entities.e3, 'новый узел появился');
    eq(state.entities.e1.x, 1, 'вход не изменён (нужен для интерполяции)');
    eq(state.tick, 1);
});

test('интерполяция: числа и массивы между снапшотами', () => {
    const from = { x: 0, y: 10, hp: 100, flags: [0, 1] };
    const to = { x: 10, y: 20, hp: 50, flags: [1, 0] };
    const half = interpolate(from, to, 0.5);
    near(half.x, 5, 1e-9);
    near(half.y, 15, 1e-9);
    near(half.hp, 75, 1e-9);
    near(half.flags[0], 0.5, 1e-9, 'массивы тоже интерполируются');
    near(interpolate(from, to, 0).x, 0, 1e-9);
    near(interpolate(from, to, 1).x, 10, 1e-9);
    near(interpolate(from, to, 9).x, 10, 1e-9, 'доля ограничена');
    const text = interpolate({ anim: 'идёт' }, { anim: 'стоит' }, 0.5);
    eq(text.anim, 'стоит', 'нечисловые поля берутся из нового');
});

test('очередь ввода: номер по порядку, старые не берём', () => {
    let dropped = 0;
    const q = createInputQueue(3, () => { dropped++; });
    eq(q.push({ seq: 1, left: true }), true);
    eq(q.push({ seq: 1, left: false }), false, 'повтор номера игнорируется');
    eq(q.push({ seq: 2, right: true }), true);
    eq(q.lastSeq(), 2);
    eq(q.size(), 2);
    eq(q.push({ seq: 5, jump: true }), true, 'пропуск принимаем');
    eq(dropped, 1, 'пропуск посчитан');
    eq(q.lastSeq(), 5);
    const taken = q.take();
    eq(taken.length, 3);
    eq(q.size(), 0, 'очередь очищена');
    // Ёмкость вытесняет старое.
    for (let i = 10; i < 20; ++i) q.push({ seq: i });
    truthy(q.size() <= 3, `ёмкость соблюдена: ${q.size()}`);
    eq(q.last().seq, 19, 'последний ввод сохранён');
    eq(q.push('чушь'), false);
    q.clear();
    eq(q.size(), 0);
});

test('авторитет: владение узлами и удаление игрока', () => {
    const auth = createAuthority();
    const p1 = auth.addPlayer();
    const p2 = auth.addPlayer();
    eq(p1, 1); eq(p2, 2);
    eq(auth.playerCount(), 2);
    eq(auth.players().join(','), '1,2');
    const hero = fakeNode(0, 0, 100);
    const crate = fakeNode(5, 5, 10);
    auth.replicate(hero, { owner: p1 });
    auth.replicate(crate, {});
    truthy(auth.owns(p1, hero), 'свой узел');
    falsy(auth.owns(p2, hero), 'чужой не его');
    eq(auth.ownerOf(crate), 0, 'ничей узел');
    eq(auth.ownedBy(p1).length, 1);
    truthy(auth.inputOf(p1), 'у игрока есть очередь ввода');
    eq(auth.inputOf(99), null);
    // Игрок ушёл: его узлы становятся ничьими.
    auth.removePlayer(p1);
    eq(auth.playerCount(), 1);
    eq(auth.ownerOf(hero), 0, 'узлы ушедшего освобождены');
    auth.unreplicate(crate);
    eq(auth.ids.size(), 1, 'снятый с репликации узел ушёл из стола');
    truthy(auth.describe().includes('игроков 1'), auth.describe());
});

test('клиентское состояние: подтверждённое, предыдущее, предсказание', () => {
    const state = createClientState();
    state.apply({ tick: 1, entities: { e1: { x: 0, y: 0 } } });
    eq(state.get('e1', 'x'), 0);
    eq(state.confirmed().tick, 1);
    state.apply({ tick: 2, entities: { e1: { x: 10 } } });
    eq(state.get('e1', 'x'), 10, 'патч применён');
    eq(state.previous().entities.e1.x, 0, 'предыдущее состояние сохранено');
    // Своё — подтверждённое, чужое — интерполированное.
    const own = state.polated('e1', true, 0.5);
    near(own.x, 10, 1e-9, 'своё не интерполируется');
    const other = state.polated('e1', false, 0.5);
    near(other.x, 5, 1e-9, 'чужое интерполируется между снапшотами');
    eq(state.polated('нет', false, 0.5), null);
    // Номера ввода растут.
    eq(state.nextInput(), 1);
    eq(state.nextInput(), 2);
    eq(state.lastSeq(), 2);
    state.reset();
    eq(state.confirmed().tick, 0);
    eq(state.lastSeq(), 0);
});

// --- Подсистема: модель целиком ---

test('$.net: роли и запрет двойного входа', () => {
    const $ = createApi();
    eq($.net.role(), 'offline');
    falsy($.net.online());
    truthy($.net.host(7777, { maxPlayers: 4 }));
    eq($.net.role(), 'server');
    truthy($.net.isServer());
    falsy($.net.host(8888), 'второй host отклонён');
    $.net.leave();
    eq($.net.role(), 'offline');
    truthy($.net.join('127.0.0.1', 7777));
    eq($.net.role(), 'client');
    truthy($.net.isClient());
    falsy($.net.join('127.0.0.1', 7777), 'второй join отклонён');
    $.net.leave();
    falsy($.net.leave(), 'повторный leave — нечего выключать');
});

test('$.net: инвариант — только сервер объявляет репликацию', () => {
    const $ = createApi();
    const hero = fakeNode(1, 1, 100);
    $.net.join('127.0.0.1', 7777);
    eq($.net.replicate(hero, { owner: 1 }), 0, 'клиент не реплицирует');
    $.net.leave();
    $.net.host(7777);
    const id = $.net.replicate(hero, { owner: 1 });
    truthy(id > 0, 'сервер объявил');
    eq($.net.idOf(hero), id, 'id тот же');
    eq($.net.ownerOf(hero), 1);
    truthy($.net.owns(1, hero));
    falsy($.net.owns(2, hero));
    eq($.net.ownedBy(1)[0], hero);
    eq($.net.nodeOfId(id), hero);
});

test('$.net: сервер считает мир, клиент рисует подтверждённое', () => {
    const $ = createApi();
    $.net.host(7777);
    const player = $.net.addPlayer();
    eq(player, 1);
    const hero = fakeNode(100, 200, 80);
    $.net.replicate(hero, { owner: player });
    const snap = $.net.snapshotNow();
    truthy(snap.entities.e1, 'узел в снапшоте');
    eq(snap.entities.e1.owner, 1);
    eq(snap.entities.e1.x, 100);
    eq(snap.entities.e1.hp, 80);
    eq(snap.tick, 1);

    // Клиент принимает снапшот и видит ровно то, что подтвердил сервер.
    const client = createApi();
    client.net.attach({ poll: () => [], send: () => {} });
    client.net.join('127.0.0.1', 7777);
    let got = null;
    client.net.on('snapshot', (s) => { got = s; });
    client.net.receive({ channel: 'snapshot', data: snap });
    truthy(got, 'событие snapshot пришло');
    eq(client.net.get('e1', 'x'), 100, 'клиент видит подтверждённое');
    eq(client.net.get('e1', 'hp'), 80);

    // Клиент шлёт ввод — сервер его получает ТОЛЬКО как ввод, не как состояние.
    const received = [];
    $.net.on('input', (p, data) => received.push({ p, data }));
    client.net.attach({ poll: () => [], send: (m) => $.net.receive(Object.assign({ player: 1 }, m)) });
    client.net.send('input', { seq: 1, right: true });
    eq(received.length, 1, 'сервер принял ввод');
    eq(received[0].p, 1);
    eq(received[0].data.right, true);
    // На клиенте схема мира не поменялась от его же ввода.
    eq(client.net.get('e1', 'x'), 100, 'ввод клиента не меняет авторитетное');
});

test('$.net: клиент не может применить чужой ввод', () => {
    const $ = createApi();
    $.net.join('127.0.0.1', 7777);
    let called = false;
    $.net.on('input', () => { called = true; });
    eq($.net.receive({ channel: 'input', player: 1, data: { seq: 1 } }), false, 'клиент отклоняет ввод');
    falsy(called, 'событие не пришло');
});

test('$.net: дельта уменьшает снапшот', () => {
    const $ = createApi();
    $.net.host(7777);
    $.net.addPlayer();
    const hero = fakeNode(0, 0, 100);
    const crate = fakeNode(50, 50, 10);
    $.net.replicate(hero, { owner: 1 });
    $.net.replicate(crate, {});
    const first = $.net.snapshotNow();
    const full = diffSnapshot(null, first, first.tick);
    eq(Object.keys(full.entities).length, 2, 'первый снапшот полный');
    // Сдвинулся только герой.
    hero._x = 5;
    const second = $.net.snapshotNow();
    const delta = diffSnapshot({ tick: first.tick, entities: first.entities }, second, second.tick);
    eq(Object.keys(delta.entities).join(','), 'e1', 'в дельте только подвинувшийся');
    eq(Object.keys(delta.entities.e1).join(','), 'x');
    // Ничего не двигалось — пустая дельта.
    const third = $.net.snapshotNow();
    const empty = diffSnapshot({ tick: second.tick, entities: second.entities }, third, third.tick);
    eq(empty.changed, 0, 'пустая дельта');
});

test('$.net: игрок ушёл — событие и освобождение узлов', () => {
    const $ = createApi();
    $.net.host(7777);
    const p1 = $.net.addPlayer();
    const hero = fakeNode(0, 0, 100);
    $.net.replicate(hero, { owner: p1 });
    const events = [];
    $.net.on('leave', (p) => events.push(p));
    truthy($.net.removePlayer(p1));
    eq(events.join(','), String(p1));
    eq($.net.ownerOf(hero), 0, 'узлы освобождены');
    falsy($.net.removePlayer(99), 'чужого игрока нет');
    eq($.net.playerCount(), 0);
});

test('$.net: события, stats и describe', () => {
    const $ = createApi();
    $.net.host(7777);
    const joins = [];
    $.net.on('join', (p) => joins.push(p));
    $.net.addPlayer();
    $.net.addPlayer();
    eq(joins.join(','), '1,2');
    eq($.net.playerCount(), 2);
    const st = $.net.stats();
    truthy(st.snapshots >= 0 && st.inputs >= 0, 'счётчики есть');
    truthy($.net.describe().includes('server'), $.net.describe());
    $.net.off('join');
    $.net.addPlayer();
    eq(joins.length, 2, 'слушатель снят');
});

test('$.net: лимит игроков соблюдается', () => {
    const $ = createApi();
    $.net.host(7777, { maxPlayers: 2 });
    eq($.net.addPlayer(), 1);
    eq($.net.addPlayer(), 2);
    eq($.net.addPlayer(), 0, 'сверх лимита не пускаем');
    eq($.net.playerCount(), 2);
});

test('$.net: транспорт подключается и опрашивается', () => {
    const $ = createApi();
    const sent = [];
    let polled = 0;
    $.net.attach({
        listen(port, opts) { this.listened = { port, opts }; },
        send(message) { sent.push(message); },
        poll() { polled++; return [{ channel: 'snapshot', data: { tick: 1, entities: { e1: { x: 7 } } } }]; },
    });
    $.net.join('127.0.0.1', 7777);
    eq($.net.transport().listened, undefined, 'клиент не слушает порт');
    $.net.send('input', { seq: 1 });
    eq(sent.length, 1, 'транспорт отправил');
    eq(sent[0].channel, 'input');
    eq($.net.poll(), 1, 'сообщение из транспорта принято');
    eq($.net.get('e1', 'x'), 7, 'снапшот применился');
    eq(polled, 1);
});

test('$.net: reset чистит сеть целиком', () => {
    const $ = createApi();
    $.net.host(7777);
    $.net.addPlayer();
    $.net.replicate(fakeNode(0, 0, 1), { owner: 1 });
    $.net.on('join', () => {});
    $.net.reset();
    eq($.net.role(), 'offline');
    eq($.net.playerCount(), 0);
    eq($.net.stats().snapshots, 0);
    eq($.net.confirmed().tick, 0);
});

test('$.net: клиент интерполирует чужие, своё берёт как есть', () => {
    const $ = createApi();
    $.net.join('127.0.0.1', 7777, { player: 1 });
    $.net.receive({ channel: 'snapshot', data: { tick: 1, entities: { e1: { x: 0 }, e2: { x: 100 } } } });
    $.net.receive({ channel: 'snapshot', data: { tick: 2, entities: { e1: { x: 20 }, e2: { x: 200 } } } });
    const own = $.net.polated('e1', true, 0.5);
    near(own.x, 20, 1e-9, 'своё — подтверждённое');
    const other = $.net.polated('e2', false, 0.5);
    near(other.x, 150, 1e-9, 'чужое — половина пути');
    eq($.net.previous().entities.e2.x, 100, 'предыдущий снапшот цел');
});

finish();
