// ===========================================================================
// Юнит-тесты генерации рейда (src/highlevel/raid.js) без движка.
//
// Проверяем то, что легко сломать: детерминированность по сиду, раскладку
// районов без дыр, рельеф, постройки внутри своего района, выходы, план спавна
// с капами, стриминг чанков и погоду.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/raid_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    makeRandom, heightNoise, layoutDistricts, districtAt, heightAt,
    planBuildings, planExits, planSpawns, planStream, chunkIndex,
    createRaid, pickWeather, WEATHERS, DISTRICTS,
} from '../../src/highlevel/raid.js';

test('makeRandom: один сид — одна последовательность', () => {
    const a = makeRandom(42);
    const b = makeRandom(42);
    const c = makeRandom(43);
    const one = [a.next(), a.next(), a.next()];
    const two = [b.next(), b.next(), b.next()];
    eq(one.join(','), two.join(','), 'сид воспроизводим');
    truthy(one[0] !== c.next(), 'другой сид — другие числа');
    for (const value of one) truthy(value >= 0 && value < 1, 'значение в 0..1');
    const r = makeRandom(7);
    for (let i = 0; i < 50; ++i) {
        const v = r.int(3, 6);
        truthy(v >= 3 && v <= 6, `int в диапазоне: ${v}`);
    }
});

test('heightNoise: гладкий и в пределах -1..1', () => {
    for (let x = 0; x < 500; x += 7) {
        const v = heightNoise(x, 5, 3);
        truthy(v >= -1.001 && v <= 1.001, `шум в пределах: ${v}`);
    }
    const near1 = Math.abs(heightNoise(100, 5, 3) - heightNoise(101, 5, 3));
    truthy(near1 < 0.2, 'соседние точки близки — шум гладкий');
});

test('layoutDistricts: покрывают всю ширину без дыр', () => {
    const width = 2400;
    const list = layoutDistricts(width, 1234);
    eq(list.length, DISTRICTS.length);
    eq(list[0].from, 0);
    eq(list[list.length - 1].to, width);
    for (let i = 1; i < list.length; ++i) {
        eq(list[i].from, list[i - 1].to, `нет дыры между ${i - 1} и ${i}`);
    }
    for (const d of list) truthy(d.to > d.from, `район ${d.id} не пустой`);
});

test('layoutDistricts: разные сиды дают разные границы', () => {
    const a = layoutDistricts(2400, 1).map((d) => d.to).join(',');
    const b = layoutDistricts(2400, 2).map((d) => d.to).join(',');
    truthy(a !== b, 'сид двигает границы');
});

test('districtAt: находит район по координате', () => {
    const list = layoutDistricts(1000, 7);
    eq(districtAt(list, 0).id, list[0].id);
    eq(districtAt(list, 999).id, list[list.length - 1].id);
    eq(districtAt(list, -10).id, list[0].id, 'левее края — первый');
    const mid = list[1];
    eq(districtAt(list, mid.from + 1).id, mid.id);
});

test('heightAt: рельеф зависит от района и координаты', () => {
    const list = layoutDistricts(2400, 11);
    const values = [];
    for (let x = 0; x < 2400; x += 50) values.push(heightAt(x, 11, list, {}));
    truthy(new Set(values).size > 5, 'рельеф не константа');
    for (const v of values) truthy(v >= 20 && v <= 60, `высота в разумных пределах: ${v}`);
});

test('planBuildings: дома внутри своего района и не наезжают', () => {
    const list = layoutDistricts(2400, 3);
    for (const d of list) {
        const houses = planBuildings(d, 3, { street: 3, groundY: 40 });
        truthy(houses.length > 0, `район ${d.id} с постройками`);
        for (const b of houses) {
            truthy(b.x >= d.from && b.x + b.w <= d.to, `дом внутри района: ${b.x}+${b.w} в ${d.from}..${d.to}`);
            truthy(b.w > 0 && b.h > 0, 'размер положительный');
            eq(b.district, d.id);
            truthy(b.rooms >= 1, 'есть комнаты');
        }
        const sorted = houses.slice().sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; ++i) {
            truthy(sorted[i].x >= sorted[i - 1].x + sorted[i - 1].w, 'дома не перекрываются');
        }
    }
});

test('planBuildings: детерминированность', () => {
    const d = layoutDistricts(2400, 5)[1];
    const a = JSON.stringify(planBuildings(d, 5, {}));
    const b = JSON.stringify(planBuildings(d, 5, {}));
    eq(a, b, 'тот же сид — те же дома');
});

test('planExits: по выходу на район плюс дальний', () => {
    const list = layoutDistricts(2400, 9);
    const exits = planExits(list, 9);
    eq(exits.length, list.length + 1);
    for (const e of exits) truthy(e.x >= 0 && e.x < 2400, `выход в мире: ${e.x}`);
    eq(exits[exits.length - 1].key, 'far');
    truthy(exits[exits.length - 1].title.includes('Дальний'));
});

test('planSpawns: капы соблюдаются', () => {
    const list = layoutDistricts(2400, 13);
    const plan = planSpawns(list, 13, { lootCap: 20, npcCap: 10 });
    truthy(plan.loot.length <= 20, `тайников не больше капа: ${plan.loot.length}`);
    truthy(plan.npcs.length <= 10, `NPC не больше капа: ${plan.npcs.length}`);
    truthy(plan.loot.length > 0 && plan.npcs.length > 0, 'что-то есть');
    for (const l of plan.loot) truthy(l.x >= 0 && l.x < 2400, 'координата в мире');
});

test('chunkIndex и planStream: окно вокруг позиции', () => {
    eq(chunkIndex(0, 32), 0);
    eq(chunkIndex(31, 32), 0);
    eq(chunkIndex(32, 32), 1);
    eq(chunkIndex(100, 32), 3);
    const plan = planStream(100, 32, 2);
    eq(plan.load.join(','), '1,2,3,4,5');
    truthy(plan.keep.has(3));
    falsy(plan.keep.has(0));
    const atStart = planStream(0, 32, 2);
    eq(atStart.load.join(','), '0,1,2', 'левее нуля чанков нет');
});

test('createRaid: план генерируется и детерминирован', () => {
    const a = createRaid({ seed: 777, width: 1200 });
    const b = createRaid({ seed: 777, width: 1200 });
    eq(a.generated, false);
    a.generate();
    b.generate();
    eq(a.generated, true);
    eq(a.buildings().length, b.buildings().length, 'одинаковое число построек');
    eq(JSON.stringify(a.districts()), JSON.stringify(b.districts()));
    eq(JSON.stringify(a.exits()), JSON.stringify(b.exits()));
    truthy(a.buildings().length > 10, 'постройки есть');
    eq(a.width, 1200);
});

test('createRaid: разные сиды — разные миры', () => {
    const a = createRaid({ seed: 1, width: 1200 }).generate();
    const b = createRaid({ seed: 2, width: 1200 }).generate();
    truthy(JSON.stringify(a.districts()) !== JSON.stringify(b.districts()), 'границы разные');
});

test('createRaid.stream: загрузка и выгрузка чанков', () => {
    const raid = createRaid({ seed: 5, width: 2400, chunk: 32, radius: 2 }).generate();
    const first = raid.stream(200);   // чанк 6
    eq(first.load.join(','), '4,5,6,7,8');
    eq(first.unload.length, 0);
    eq(raid.loadedChunks().join(','), '4,5,6,7,8');
    // Сдвинулись вправо — левые чанки выгружаются.
    const second = raid.stream(400);  // чанк 12
    truthy(second.load.length > 0, 'новые чанки грузятся');
    truthy(second.unload.length > 0, 'дальние выгружаются');
    truthy(raid.loadedChunks().every((c) => c >= 10 && c <= 14), 'в памяти только окно');
    // Возврат назад не «теряет» состояние.
    const back = raid.stream(200);
    eq(back.load.join(','), '4,5,6,7,8');
});

test('createRaid.chunkContent: что лежит в чанке', () => {
    const raid = createRaid({ seed: 3, width: 1200, chunk: 64 }).generate();
    let found = null;
    for (let i = 0; i < 20 && !found; ++i) {
        const content = raid.chunkContent(i);
        if (content.buildings.length || content.loot.length) found = content;
    }
    truthy(found, 'хотя бы один чанк с содержимым');
    truthy(found.heights.length > 0, 'есть срез рельефа');
    for (const b of found.buildings) {
        truthy(b.x < found.to && b.x + b.w > found.from, 'постройка перекрывает чанк');
    }
    for (const l of found.loot) truthy(l.x >= found.from && l.x < found.to, 'тайник внутри чанка');
});

test('createRaid.takePending: чанки к наполнению отдаются один раз', () => {
    const raid = createRaid({ seed: 8, width: 1200, chunk: 32, radius: 1 }).generate();
    raid.stream(100);
    const first = raid.takePending();
    eq(first.length, 3);
    eq(raid.takePending().length, 0, 'повторно не отдаются');
    raid.stream(200);
    truthy(raid.takePending().length > 0, 'новый сдвиг — новые чанки');
});

test('createRaid.save/load: план и окно чанков переживают запись', () => {
    const raid = createRaid({ seed: 21, width: 1200, chunk: 32, radius: 1 }).generate();
    raid.stream(300);
    const data = JSON.parse(JSON.stringify(raid.save()));
    eq(data.seed, 21);
    const restored = createRaid({ seed: 1, width: 1200 }).load(data);
    eq(restored.seed, 21);
    eq(restored.loadedChunks().join(','), raid.loadedChunks().join(','));
    eq(restored.buildings().length, raid.buildings().length, 'план тот же');
});

test('createRaid.reseed: новый сид — новый мир', () => {
    const raid = createRaid({ seed: 1, width: 1200 }).generate();
    const before = JSON.stringify(raid.districts());
    raid.reseed(99);
    raid.generate();
    truthy(JSON.stringify(raid.districts()) !== before, 'мир сменился');
    eq(raid.seed, 99);
});

test('pickWeather: виды и детерминированность', () => {
    const a = pickWeather(5);
    const b = pickWeather(5);
    eq(a.id, b.id, 'тот же сид — та же погода');
    const kinds = new Set();
    for (let i = 0; i < 500; ++i) kinds.add(pickWeather(i * 7 + 1).id);
    truthy(kinds.size >= 3, `погода разнообразна: ${[...kinds].join(',')}`);
    for (const id of kinds) truthy(WEATHERS.some((w) => w.id === id), 'вид из списка');
    truthy(WEATHERS.every((w) => typeof w.fog === 'number' && typeof w.loud === 'number'),
           'у погоды есть влияние');
});

finish();
