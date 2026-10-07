// ===========================================================================
// Юнит-тесты оружия и баллистики (src/highlevel/weapons.js) без движка.
//
// Проверяем то, что легко сломать: темп и режимы огня, магазин и перезарядку
// (включая дробовик по патрону), отдачу и разброс, навесное и затухание урона.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/weapons_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    normalizeWeapon, normalizeMod, combineStats, falloff, penetrationAgainst,
    spreadFor, createWeapons, createWeapon,
} from '../../src/highlevel/weapons.js';

function db() {
    const w = createWeapons();
    w.define({ id: 'ak', name: 'АК', damage: 35, rpm: 600, ammo: 30, reload: 2.4,
               spread: 1.4, recoil: 1.1, velocity: 900, falloff: 400,
               modes: ['auto', 'single'], style: 'magazine' });
    w.define({ id: 'pistol', name: 'Пистолет', damage: 20, rpm: 300, ammo: 8, reload: 1.6,
               spread: 1.0, recoil: 1.5, modes: ['single'] });
    w.define({ id: 'shotgun', name: 'Дробовик', damage: 15, rpm: 60, ammo: 6, reload: 3.0,
               pellets: 8, spread: 4, recoil: 3, style: 'shells', modes: ['single'] });
    w.define({ id: 'knife', name: 'Нож', kind: 'melee', damage: 40 });
    w.defineMod({ id: 'brake', slot: 'muzzle', spread: 0.7, recoil: 0.85, mass: 0.3, value: 500 });
    w.defineMod({ id: 'extmag', slot: 'mag', ammo: 1.5, mass: 0.4 });
    w.defineMod({ id: 'grip', slot: 'grip', recoil: 0.8 });
    return w;
}

test('normalizeWeapon: значения по умолчанию и режимы', () => {
    const w = normalizeWeapon({ id: 'x' });
    eq(w.kind, 'gun');
    eq(w.rpm, 600);
    eq(w.modes.join(','), 'single');
    eq(w.pellets, 1);
    eq(w.style, 'magazine');
    eq(normalizeWeapon(null), null);
    eq(normalizeWeapon({}), null, 'без id ствола не бывает');
    const melee = normalizeWeapon({ id: 'k', kind: 'melee' });
    eq(melee.kind, 'melee');
    eq(melee.style, 'none', 'у холодного оружия нет перезарядки');
});

test('normalizeMod: множители и добавки', () => {
    const m = normalizeMod({ id: 'brake', slot: 'muzzle', spread: 0.7, recoil: 0.85, ammo: 1.5, pellets: 2 });
    eq(m.slot, 'muzzle');
    near(m.mult.spread, 0.7, 1e-9);
    near(m.mult.recoil, 0.85, 1e-9);
    near(m.mult.ammo, 1.5, 1e-9, 'магазин — множитель');
    eq(m.add.pellets, 2, 'дробин — добавка');
    eq(normalizeMod(null), null);
    eq(normalizeMod({ id: 'm' }).slot, 'muzzle', 'слот по умолчанию');
});

test('combineStats: навесное множит и складывает', () => {
    const w = db();
    const base = w.get('ak');
    const brake = w.mod('brake');
    const extmag = w.mod('extmag');
    const stats = combineStats(base, [brake, extmag]);
    near(stats.spread, 1.4 * 0.7, 1e-9);
    near(stats.recoil, 1.1 * 0.85, 1e-9);
    eq(stats.ammo, 45, 'магазин умножается и округляется');
    near(stats.damage, 35, 1e-9, 'урон не тронут');
    const empty = combineStats(base, []);
    near(empty.spread, base.spread, 1e-9, 'без навесного — базовые');
});

test('создание ствола: магазин полный', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    eq(gun.magazine, 30);
    eq(gun.capacity, 30);
    eq(gun.shots, 0);
    eq(gun.mode, 'auto');
    eq(createWeapon('нет', { defs: w }), null);
});

test('fire: темп держится кулдауном', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    eq(gun.fire().fired, true);
    eq(gun.magazine, 29);
    const second = gun.fire();
    eq(second.fired, false);
    eq(second.reason, 'cooldown');
    gun.tick(0.1);   // 600 rpm = 0.1 с на выстрел
    eq(gun.fire().fired, true);
});

test('fire: пустой магазин не стреляет', () => {
    const w = db();
    const gun = createWeapon('pistol', { defs: w, mods: w });
    for (let i = 0; i < 8; ++i) { gun.fire(); gun.tick(1); }
    eq(gun.magazine, 0);
    const empty = gun.fire();
    eq(empty.fired, false);
    eq(empty.reason, 'empty');
});

test('fire: одиночный режим не стреляет от удержания', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    gun.mode = 'single';
    eq(gun.fire({ held: true }).fired, true, 'первое нажатие');
    gun.tick(1);
    const held = gun.fire({ held: true });
    eq(held.fired, false);
    eq(held.reason, 'single', 'на удержании не стреляет');
    gun.tick(0.1);
    eq(gun.fire({ again: true }).fired, true, 'повторное нажатие — выстрел');
});

test('fire: отдача и разброс растут от стрельбы', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    const first = gun.fire();
    truthy(first.spread > 0, 'разброс есть');
    truthy(gun.heat > 0, 'перегрев появился');
    const before = gun.heat;
    gun.tick(1.0);
    truthy(gun.heat < before, 'перегрев спадает');
    truthy(gun.recoilAccumulated < first.recoil || gun.recoilAccumulated === 0,
           'отдача остывает');
});

test('spreadFor: перегрев расширяет разброс', () => {
    near(spreadFor(1, 1, 0), 1, 1e-9, 'без перегрева — базовый');
    truthy(spreadFor(1, 1, 1) > spreadFor(1, 1, 0), 'с перегревом шире');
    near(spreadFor(0, 0, 1), 0, 1e-9, 'нулевой разброс остаётся нулевым');
});

test('перезарядка: время и дозарядка до полного', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    for (let i = 0; i < 10; ++i) { gun.fire(); gun.tick(0.1); }
    eq(gun.magazine, 20);
    eq(gun.reload(), true);
    truthy(gun.reloading);
    const blocked = gun.fire();
    eq(blocked.fired, false);
    eq(blocked.reason, 'reloading');
    gun.tick(2.4);
    eq(gun.magazine, 30, 'магазин полон');
    falsy(gun.reloading);
});

test('перезарядка: дробовик заряжается по патрону', () => {
    const w = db();
    const gun = createWeapon('shotgun', { defs: w, mods: w });
    for (let i = 0; i < 3; ++i) { gun.fire(); gun.tick(1); }
    eq(gun.magazine, 3);
    eq(gun.reload(), true);
    // Патрон за патроном: за треть времени заряжается один патрон.
    gun.tick(1.0);
    eq(gun.magazine, 4, 'первый патрон за 1/3 перезарядки');
    truthy(gun.reloading, 'перезарядка ещё идёт');
    gun.tick(2.5);
    eq(gun.magazine, 6, 'к концу заряжен полностью');
    falsy(gun.reloading);
});

test('перезарядка: прерывание и запрет при полном магазине', () => {
    const w = db();
    const gun = createWeapon('pistol', { defs: w, mods: w });
    eq(gun.reload(), false, 'полный магазин не перезаряжают');
    gun.fire(); gun.tick(1);
    eq(gun.reload(), true);
    eq(gun.cancelReload(), true);
    falsy(gun.reloading);
    eq(gun.magazine, 7, 'патроны не дозарядились');
});

test('меле: не тратит патроны и не имеет разброса', () => {
    const w = db();
    const knife = createWeapon('knife', { defs: w, mods: w });
    const r = knife.fire();
    eq(r.fired, true);
    eq(r.reason, 'melee');
    eq(r.damage, 40);
    eq(knife.magazine, 0);
    eq(knife.reload(), false, 'нож не перезаряжается');
});

test('навесное: замена слота возвращает прежний мод', () => {
    const w = db();
    w.defineMod({ id: 'brake2', slot: 'muzzle', spread: 0.5 });
    const gun = createWeapon('ak', { defs: w, mods: w });
    eq(gun.attach('brake'), null, 'первый мод — ничего не снято');
    near(gun.stats.spread, 1.4 * 0.7, 1e-9);
    eq(gun.attach('brake2'), 'brake', 'второй мод снял первый');
    near(gun.stats.spread, 1.4 * 0.5, 1e-9);
    eq(gun.attach('нет-такого'), null);
    eq(gun.mods().length, 1);
});

test('навесное: чужой слот отвергается', () => {
    const w = db();
    w.defineMod({ id: 'scope', slot: 'optic' });
    w.define({ id: 'narrow', damage: 10, slots: ['muzzle'] });
    const gun = createWeapon('narrow', { defs: w, mods: w });
    eq(gun.attach('scope'), null, 'у ствола нет такого слота');
    eq(gun.mods().length, 0);
});

test('detach: снятие по слоту и всё сразу', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    gun.attach('brake');
    gun.attach('grip');
    eq(gun.detach('grip'), 'grip');
    eq(gun.mods().length, 1);
    const all = gun.detach();
    eq(all.join(','), 'brake');
    eq(gun.mods().length, 0);
    eq(gun.detach('muzzle'), null);
});

test('магазин с навесным: capacity растёт', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    eq(gun.capacity, 30);
    gun.attach('extmag');
    eq(gun.capacity, 45);
    eq(gun.magazine, 30, 'патроны не добавляются сами');
    gun.load(20);
    eq(gun.magazine, 45, 'load доливает до нового предела');
    eq(gun.load(10), 0, 'больше предела не влезает');
});

test('falloff: урон падает с расстоянием, но не до нуля', () => {
    near(falloff(35, 100, 400), 35, 1e-9, 'близко — полный');
    near(falloff(35, 400, 400), 35, 1e-9, 'на пороге — полный');
    const far = falloff(35, 800, 400);
    truthy(far < 35 && far > 0, `далеко меньше: ${far.toFixed(1)}`);
    const veryFar = falloff(35, 5000, 400);
    truthy(veryFar >= 35 * 0.4 - 1e-9, 'пол не ниже 40%');
});

test('penetrationAgainst: пробитие снимает класс брони', () => {
    eq(penetrationAgainst(0, 3), 3);
    eq(penetrationAgainst(1, 3), 2);
    eq(penetrationAgainst(3, 3), 0);
    eq(penetrationAgainst(9, 3), 0, 'ниже нуля не уходит');
    eq(penetrationAgainst(2, 0), 0, 'без брони нечего пробивать');
});

test('save/load: магазин, моды и режим переживают запись', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    gun.attach('brake');
    gun.mode = 'single';
    gun.fire(); gun.tick(1);
    const data = JSON.parse(JSON.stringify(gun.save()));
    const restored = createWeapon('ak', { defs: w, mods: w });
    restored.load2(data);
    eq(restored.magazine, gun.magazine);
    eq(restored.mods().map((m) => m.id).join(','), 'brake');
    eq(restored.mode, 'single');
    truthy(restored.stats.spread < gun.stats.spread + 1e-9, 'навесное учтено');
});

test('cycleMode переключает режимы по кругу', () => {
    const w = db();
    const gun = createWeapon('ak', { defs: w, mods: w });
    eq(gun.mode, 'auto');
    eq(gun.cycleMode(), 'single');
    eq(gun.cycleMode(), 'auto');
    gun.mode = 'нет-такого';
    eq(gun.mode, 'auto', 'неизвестный режим отвергнут');
});

test('weapons.load: пачка стволов и модов', () => {
    const w = createWeapons();
    eq(w.load([{ id: 'a' }, { id: 'b' }]), 2);
    eq(w.ids().length, 2);
    eq(w.load({ weapons: [{ id: 'c' }] }), 1);
    eq(w.loadMods([{ id: 'm', slot: 'muzzle' }]), 1);
    truthy(w.mod('m'));
    eq(w.get('нет'), null);
});

finish();
