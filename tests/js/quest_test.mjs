// ===========================================================================
// Юнит-тесты ядра заданий (src/highlevel/quest.js) без движка.
//
// Проверяем то, что легко сломать: условия открытия (after/after_any/excludes),
// правило «взятое не пропадает», прогресс целей, события рейда, награду и сейв.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/quest_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createBook } from '../../src/highlevel/quest.js';

function makeBook() {
    const flags = {};
    const book = createBook({ flags, seenScenes: [] });
    book.define({ id: 'prologue', title: 'Пролог', objectives: [] });
    book.define({
        id: 'relay', title: 'Ретранслятор', giver: 'kek', after: ['prologue'], order: 10,
        objectives: [{ kind: 'object', object_id: 'relay_a', count: 2 }],
        reward: { money: 500, items: { medkit: 1 }, trust: 2 },
        flags: { accept: ['relay_started'], done: ['relay_off'] },
    });
    book.define({
        id: 'hunt', title: 'Охота', giver: 'kek',
        objectives: [{ kind: 'kill', count: 3, map: 'RaidPgt' }],
    });
    return { book, flags };
}

test('status: пусто — locked, после after — available', () => {
    const { book } = makeBook();
    eq(book.status('relay'), 'locked');
    eq(book.status('hunt'), 'available', 'без условий доступно сразу');
    eq(book.accept('relay'), false, 'закрытое задание не взять');
});

test('accept: ставит флаги и переводит в active', () => {
    const { book, flags } = makeBook();
    eq(book.accept('hunt'), true);
    eq(book.status('hunt'), 'active');
    eq(book.accept('hunt'), false, 'повторно не взять');
});

test('after: открывается после сдачи всех перечисленных', () => {
    const { book } = makeBook();
    book.accept('prologue');
    eq(book.turnIn('prologue').ok, true, 'пролог без целей сдаётся сразу');
    eq(book.status('relay'), 'available');
});

test('after_any: достаточно любого из списка (развилка)', () => {
    const { book } = makeBook();
    book.define({ id: 'a', title: 'A', objectives: [] });
    book.define({ id: 'b', title: 'B', objectives: [] });
    book.define({ id: 'fork', title: 'Развилка', after_any: ['a', 'b'], objectives: [] });
    eq(book.status('fork'), 'locked');
    book.accept('b'); book.turnIn('b');
    eq(book.status('fork'), 'available');
});

test('excludes: взятое или сданное близнец-задание закрывает', () => {
    const { book } = makeBook();
    book.define({ id: 'mercy', title: 'Милосердие', objectives: [] });
    book.define({ id: 'cold', title: 'Холод', excludes: ['mercy'], objectives: [] });
    eq(book.status('cold'), 'available');
    book.accept('mercy');
    eq(book.status('cold'), 'locked', 'взятая ветка закрывает вторую');
});

test('requires_flags и requires_scenes не пускают раньше времени', () => {
    const flags = {};
    const seen = [];
    const book = createBook({ flags, seenScenes: seen });
    book.define({ id: 'pass', title: 'Пропуск', requires_flags: ['badge'], objectives: [] });
    book.define({ id: 'call', title: 'Звонок', requires_scenes: ['intro_call'], objectives: [] });
    eq(book.status('pass'), 'locked');
    eq(book.status('call'), 'locked');
    flags.badge = true;
    seen.push('intro_call');
    eq(book.status('pass'), 'available');
    eq(book.status('call'), 'available');
});

test('прогресс цели и isReady по count', () => {
    const { book } = makeBook();
    // Сначала открываем «Ретранслятор»: он требует сданного пролога.
    book.accept('prologue');
    book.turnIn('prologue');
    book.accept('relay');
    eq(book.isReady('relay'), false);
    eq(book.progress('relay', 0), 0);
    book.progress('relay', 0, 1);
    eq(book.progress('relay', 0), 1);
    eq(book.isReady('relay'), false, 'нужно два');
    book.progress('relay', 0, 'нет');
    eq(book.progress('relay', 0), 0, 'мусор в прогрессе — ноль');
    book.progress('relay', 0, 5);
    eq(book.progress('relay', 0), 2, 'прогресс не превышает count');
    eq(book.isReady('relay'), true);
    eq(book.status('relay'), 'ready');
});

test('turnIn: награда, флаги и запрет на невыполненное', () => {
    const { book, flags } = makeBook();
    book.accept('prologue');
    book.turnIn('prologue');
    book.accept('relay');
    const early = book.turnIn('relay');
    eq(early.ok, false, 'с невыполненными целями не сдать');
    book.progress('relay', 0, 2);
    const reward = book.turnIn('relay');
    eq(reward.ok, true);
    eq(reward.money, 500);
    eq(reward.trust, 2);
    eq(reward.items.medkit, 1);
    truthy(flags.relay_started, 'флаг взятия');
    truthy(flags.relay_off, 'флаг сдачи');
    eq(book.status('relay'), 'done');
});

test('взятое задание не пропадает даже если близнец сдан раньше', () => {
    const { book } = makeBook();
    book.define({ id: 'mercy', title: 'Милосердие', objectives: [] });
    book.define({ id: 'cold', title: 'Холод', excludes: ['mercy'], objectives: [] });
    book.accept('cold');
    // Ветка-близнец сдана раньше (старый сейв или другой путь).
    book.accept('mercy');
    book.turnIn('mercy');
    // У «холода» целей нет, поэтому он сразу готов — важно, что не locked.
    eq(book.status('cold'), 'ready', 'взятое остаётся взятым, а не locked');
});

test('onKill: считает только подходящую карту', () => {
    const { book } = makeBook();
    book.accept('hunt');
    book.onKill('OtherMap');
    eq(book.progress('hunt', 0), 0, 'другая карта не считается');
    book.onKill('RaidPgt');
    eq(book.progress('hunt', 0), 1);
    book.onKill('RaidPgt');
    const done = book.onKill('RaidPgt');
    eq(book.progress('hunt', 0), 3);
    truthy(done.includes('hunt'), 'готовое задание вернулось в списке');
});

test('onObject: совпадение по object_id и карте', () => {
    const { book } = makeBook();
    book.accept('prologue');
    book.turnIn('prologue');
    book.accept('relay');
    book.onObject('RaidPgt', 'other');
    eq(book.progress('relay', 0), 0, 'чужой объект не считается');
    book.onObject('RaidPgt', 'relay_a');
    eq(book.progress('relay', 0), 1);
    book.onObject('RaidPgt', 'relay_a');
    eq(book.progress('relay', 0), 2, 'свой объект считается дважды');
});

test('onExtract: extract и haul по стоимости рюкзака', () => {
    const { book } = makeBook();
    book.define({ id: 'run', title: 'Рейд', objectives: [
        { kind: 'extract', count: 2 },
        { kind: 'haul', count: 1000 },
    ] });
    book.accept('run');
    book.onExtract('RaidPgt', 500);
    eq(book.progress('run', 0), 1, 'эвакуация засчитана');
    eq(book.progress('run', 1), 0, 'рюкзак дешевле порога');
    book.onExtract('RaidPgt', 1500);
    eq(book.progress('run', 1), 1, 'дорогой рюкзак засчитан');
    eq(book.isReady('run'), true);
});

test('onSpare и onFetch', () => {
    const { book } = makeBook();
    book.define({ id: 'mercy_run', title: 'Пощада', objectives: [{ kind: 'spare', count: 2 }] });
    book.define({ id: 'meds', title: 'Медикаменты', objectives: [{ kind: 'fetch', item: 'medkit', count: 2 }] });
    book.accept('mercy_run');
    book.accept('meds');
    book.onSpare('RaidPgt', 2);
    eq(book.progress('mercy_run', 0), 2);
    book.onFetch('bandage', 5);
    eq(book.progress('meds', 0), 0, 'другой предмет не считается');
    book.onFetch('medkit', 3);
    eq(book.progress('meds', 0), 2, 'не больше count');
});

test('merciful_branch: ветка выбирается при взятии по числу флагов', () => {
    const flags = { seal_hidden: 1, witness: 1, other: 1 };
    const book = createBook({ flags, mercifulFlags: ['seal_hidden', 'witness'], mercifulThreshold: 2 });
    book.define({ id: 'escape', title: 'Побег', merciful_branch: ['mercy_way', 'cold_way'], objectives: [] });
    book.accept('escape');
    truthy(flags.mercy_way, 'флагов достаточно — милосердная ветка');
    falsy(flags.cold_way);
});

test('forGiver: только доступные, взятые и готовые', () => {
    const { book } = makeBook();
    book.define({ id: 'hidden', title: 'Секрет', giver: 'kek', after: ['никогда'], objectives: [] });
    const list = book.forGiver('kek').map((d) => d.id);
    truthy(list.includes('hunt'));
    falsy(list.includes('relay'), 'закрытое не показываем');
    falsy(list.includes('hidden'));
});

test('save/load: состояние и прогресс переживают запись', () => {
    const { book } = makeBook();
    book.accept('prologue');
    book.turnIn('prologue');
    book.accept('relay');
    book.progress('relay', 0, 1);
    const data = JSON.parse(JSON.stringify(book.save()));
    const flags = {};
    const restored = createBook({ flags });
    restored.define({ id: 'relay', title: 'Ретранслятор', objectives: [{ kind: 'object', count: 2 }] });
    restored.load(data);
    eq(restored.stateOf('relay').status, 'active', 'состояние из сейва');
    eq(restored.status('relay'), 'active', 'статус восстановлен');
    eq(restored.progress('relay', 0), 1);
    eq(restored.isReady('relay'), false);
});

test('describe и line: подписи целей', () => {
    const { book } = makeBook();
    eq(book.describe({ kind: 'fetch', item: 'medkit', count: 2 }), 'Принести: medkit × 2');
    eq(book.describe({ kind: 'kill', count: 3, map: 'RaidPgt' }), 'Убить одичалых: 3 (RaidPgt)');
    eq(book.describe({ kind: 'haul', count: 1000 }), 'Вынести рюкзак дороже 1000 руб.');
    eq(book.describe({ kind: 'object', count: 1, text: 'Своя подпись' }), 'Своя подпись');
    book.accept('prologue');
    book.turnIn('prologue');
    book.accept('relay');
    book.progress('relay', 0, 1);
    truthy(book.line('relay').includes('1/2'), 'в строке журнала прогресс');
});

finish();
