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
    createHistory, createPrediction, smoothState,
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

test('$.net: high-level surface and topology defaults', () => {
    const $ = createApi();
    eq($.net.topology(), 'authoritative');
    eq($.net.authority(), 'host');
    falsy($.net.online());
    eq(typeof $.net.start, 'function');
    eq(typeof $.net.room.create, 'function');
    eq(typeof $.net.relay.enable, 'function');
    eq(typeof $.net.simulate, 'function');
    // Gameplay scripts do not receive transport hooks or frame polling.
    eq($.net.attach, undefined);
    eq($.net.bindEngine, undefined);
    eq($.net.poll, undefined);
    eq($.net.step, undefined);
    $.net.topology('mesh');
    eq($.net.topology(), 'mesh');
    $.net.topology('custom');
    eq($.net.topology(), 'custom');
    $.net.topology('authoritative');
    eq($.net.start({ listen: 7777 }), false, 'offline JS harness has no native ENet');
    falsy($.net.online());
});

test('$.net: host/client API exposes high-level helpers only', () => {
    const $ = createApi();
    eq($.net.available(), false, 'unit harness has no native transport');
    eq($.net.host(7777), false, 'host reports unavailable transport');
    eq($.net.join('127.0.0.1', 7777), false, 'join reports unavailable transport');
    eq($.net.send('input', { seq: 1 }), false, 'offline send is rejected');
    eq($.net.leave(), false, 'leaving an offline session is a no-op');
    const prediction = $.net.predict((state, input) => ({ x: (state.x || 0) + input.dx }));
    eq(typeof prediction.apply, 'function');
    eq(typeof $.net.room.join, 'function');
    eq(typeof $.net.relay.forward, 'function');
});

// --- История (лаг-компенсация) ---

test('история: состояние на момент времени', () => {
    const h = createHistory(10, 1);
    eq(h.size(), 0, 'сначала пусто');
    eq(h.range(), null);
    h.push(0, { e1: { x: 0 } });
    h.push(0.1, { e1: { x: 10 } });
    h.push(0.2, { e1: { x: 20 } });
    eq(h.size(), 3);
    eq(h.range().from, 0);
    eq(h.range().to, 0.2);
    eq(h.at(0.1, 'e1').x, 10, 'точное время');
    eq(h.at(0.15, 'e1').x, 10, 'между кадрами — ближайший НЕ позже');
    eq(h.at(99, 'e1').x, 20, 'позже окна — последний');
    eq(h.at(-5, 'e1').x, 0, 'раньше окна — первый');
    eq(h.at(0.1).e1.x, 10, 'без ключа — все сущности');
    eq(h.at(0.1, 'нет'), null);
});

test('история: перемотка на задержку', () => {
    const h = createHistory(10, 1);
    for (let i = 0; i <= 5; ++i) h.push(i * 0.1, { e1: { x: i * 100 } });
    // Сейчас 0.5, задержка 0.2 → смотрим на 0.3, где x был 300.
    eq(h.rewind(0.5, 0.2, 'e1').x, 300, 'перемотка на половину RTT');
    eq(h.rewind(0.5, 0, 'e1').x, 500, 'без задержки — текущее');
});

test('история: вытеснение по количеству и по времени', () => {
    const byCount = createHistory(3, 100);
    for (let i = 0; i < 10; ++i) byCount.push(i, { e1: { x: i } });
    eq(byCount.size(), 3, 'держим не больше ёмкости');
    eq(byCount.at(0, 'e1').x, 7, 'старое вытеснено');
    const byTime = createHistory(100, 0.5);
    for (let i = 0; i <= 10; ++i) byTime.push(i * 0.1, { e1: { x: i } });
    const range = byTime.range();
    truthy(range.to - range.from <= 0.6, `окно не шире заданного: ${(range.to - range.from).toFixed(2)}`);
    byTime.clear();
    eq(byTime.size(), 0);
});

// --- Предсказание ---

/** Простая симуляция: движение по вводу (та же функция у клиента и сервера). */
function moveSim(state, input) {
    const out = Object.assign({ x: 0, y: 0, seq: 0 }, state || {});
    if (input) {
        out.x += Number(input.dx) || 0;
        out.seq = Math.max(out.seq, Number(input.seq) || 0);
    }
    return out;
}

test('предсказание: ввод применяется сразу', () => {
    const p = createPrediction(moveSim);
    eq(p.state(), null, 'до ввода состояния нет');
    const s1 = p.apply({ seq: 1, dx: 10 });
    eq(s1.x, 10, 'ввод применён немедленно');
    const s2 = p.apply({ seq: 2, dx: 5 });
    eq(s2.x, 15);
    eq(p.pending(), 2, 'два ввода ждут подтверждения');
    eq(p.acknowledged(), 0);
});

test('предсказание: подтверждение откатывает и повторяет неподтверждённое', () => {
    const p = createPrediction(moveSim);
    p.apply({ seq: 1, dx: 10 });
    p.apply({ seq: 2, dx: 10 });
    eq(p.state().x, 20, 'клиент уже ушёл вперёд');
    // Сервер подтвердил только первый ввод и говорит x = 12 (чуть иначе).
    const after = p.acknowledge({ x: 12, seq: 1 }, 1);
    eq(after.x, 22, 'к серверной правде применён неподтверждённый ввод');
    eq(p.pending(), 1, 'второй ввод ещё не подтверждён');
    eq(p.acknowledged(), 1);
    eq(p.corrections(), 1, 'коррекция зафиксирована');
    truthy(p.error() >= 0, 'разница с правдой видна игре');
    // Подтвердили и второй.
    p.acknowledge({ x: 22, seq: 2 }, 2);
    eq(p.pending(), 0);
    eq(p.state().x, 22, 'сошлось с сервером');
});

test('предсказание: чужой правды не выдумывает и сбрасывается', () => {
    const p = createPrediction(moveSim);
    const ack = p.acknowledge({ x: 100, seq: 0 }, 0);
    eq(ack.x, 100, 'без ввода берём серверное состояние');
    eq(p.pending(), 0);
    p.apply({ seq: 1, dx: 1 });
    p.reset();
    eq(p.state(), null);
    eq(p.pending(), 0);
    eq(p.corrections(), 0);
    // Без функции шага предсказание просто передаёт состояние.
    const passthrough = createPrediction(null);
    passthrough.apply({ seq: 1, dx: 5 });
    eq(passthrough.state().seq, 1, 'шаг по умолчанию — тождество');
});

// --- сглаживание откатов ---
// Смысл: после отката клиент повторяет ввод, и `predicted` может прыгнуть.
// Рисовать его напрямую — картинка дёргается. Визуал подтягивается плавно,
// а при настоящем телепорте (расхождение больше snap) ставится сразу.

test('smoothState: первый вызов берёт цель как есть', () => {
    const v = smoothState(null, { x: 10, y: 20 }, 1 / 60, { rate: 12 });
    eq(v.x, 10);
    eq(v.y, 20);
});

test('smoothState: подтягивает к цели, но НЕ сразу', () => {
    let v = { x: 0, y: 0 };
    v = smoothState(v, { x: 100, y: 0 }, 1 / 60, { rate: 12 });
    truthy(v.x > 0, `сдвинулось от нуля (${v.x})`);
    truthy(v.x < 100, `но НЕ телепортировалось (${v.x})`);
    // За секунду должно подойти близко.
    for (let i = 0; i < 120; ++i) v = smoothState(v, { x: 100, y: 0 }, 1 / 60, { rate: 12 });
    near(v.x, 100, 0.5);
});

test('smoothState: snap сдаётся и ставит значение сразу (телепорт)', () => {
    const v = smoothState({ x: 0, y: 0 }, { x: 5000, y: 0 }, 1 / 60,
                          { rate: 12, snap: 500 });
    eq(v.x, 5000, 'дальний скачок ставится сразу');
});

test('smoothState: без snap телепорт тоже сглаживается', () => {
    const v = smoothState({ x: 0, y: 0 }, { x: 5000, y: 0 }, 1 / 60, { rate: 12 });
    truthy(v.x > 0 && v.x < 5000, `тянется, а не прыгает (${v.x})`);
});

test('smoothState: нечисловые поля берутся как есть', () => {
    const v = smoothState({ pose: 'idle' }, { pose: 'run', x: 5 }, 1 / 60, {});
    eq(v.pose, 'run', 'позу не интерполируем — она не число');
    eq(v.x, 5);
});

test('smoothState: цели нет — значение не выдумывается', () => {
    const v = smoothState({ x: 3 }, null, 1 / 60, {});
    eq(Object.keys(v).length, 0, 'пустая цель даёт пустой результат');
});

test('prediction: первый visual ставит цель сразу (инициализация)', () => {
    const p = createPrediction((st, input) => ({ x: (st.x || 0) + input.dx }));
    p.apply({ seq: 1, dx: 100 });
    // Иначе визуал «приползал» бы из нуля при появлении игрока.
    eq(p.visual(1 / 60, { rate: 12 }).x, 100, 'первый вызов — без сглаживания');
    eq(p.visualError(), 0, 'и отставания нет');
});

test('prediction: visual догоняет сдвинувшуюся цель', () => {
    const p = createPrediction((st, input) => ({ x: (st.x || 0) + input.dx }));
    p.apply({ seq: 1, dx: 100 });
    p.visual(1 / 60, { rate: 12 });          // инициализация на 100
    p.apply({ seq: 2, dx: 100 });            // цель уехала на 200
    const v1 = p.visual(1 / 60, { rate: 12 });
    truthy(v1.x > 100 && v1.x < 200, `визуал между 100 и 200 (${v1.x})`);
    truthy(p.visualError() > 0, 'отставание видно');
    for (let i = 0; i < 120; ++i) p.visual(1 / 60, { rate: 12 });
    truthy(p.visualError() < 1, `догнал (${p.visualError()})`);
});

test('prediction: откат НЕ сбрасывает визуал (в этом и смысл)', () => {
    const p = createPrediction((st, input) => ({ x: (st.x || 0) + input.dx }));
    p.apply({ seq: 1, dx: 100 });
    p.visual(1 / 60, { rate: 12 });
    const before = p.visual(1 / 60, { rate: 12 }).x;
    // Сервер прислал правду: она ближе к нулю, чем предсказание.
    p.acknowledge({ x: 0 }, 1);
    const v = p.visual(1 / 60, { rate: 12 });
    truthy(v.x <= before + 1e-9, `после отката визуал не прыгнул вверх (${v.x} <= ${before})`);
});

test('prediction: resetVisual забывает визуал', () => {
    const p = createPrediction((st, input) => ({ x: (st.x || 0) + input.dx }));
    p.apply({ seq: 1, dx: 10 });
    p.visual(1 / 60, {});                    // инициализация
    p.apply({ seq: 2, dx: 90 });             // цель уехала — визуал отстал
    p.visual(1 / 60, {});
    truthy(p.visualError() > 0, 'отставание есть до сброса');
    p.resetVisual();
    eq(p.visualError(), 0, 'после сброса отставания нет');
});

finish();
