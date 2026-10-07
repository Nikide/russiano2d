// ===========================================================================
// Юнит-тесты предметов и инвентаря (src/highlevel/items.js) без движка.
//
// Проверяем то, что легко сломать: укладку по размеру в клетках, стопки,
// освобождение клеток, вес с бонусами, надевание и переполнение.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/items_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    normalizeItem, createGrid, canPlace, findPlace, fillCells,
    createItems, createInventory,
} from '../../src/highlevel/items.js';

function defs() {
    const items = createItems();
    items.define({ id: 'ak', title: 'АК', kind: 'weapon', size: [6, 2], mass: 3.8, value: 9000, wear: 'back' });
    items.define({ id: 'pistol', title: 'Пистолет', kind: 'weapon', size: [2, 2], mass: 1.1, value: 3000, wear: 'holster' });
    items.define({ id: 'medkit', title: 'Аптечка', kind: 'med', size: [1, 2], mass: 0.6, value: 300, heal: 40, stack: 3 });
    items.define({ id: 'ammo', title: 'Патроны', kind: 'ammo', size: [1, 1], mass: 0.01, value: 5, stack: 60 });
    items.define({ id: 'vest', title: 'Жилет', kind: 'armor', size: [2, 2], mass: 4.0, value: 5000,
                   wear: 'armor', armor_class: 3, durability: 100 });
    items.define({ id: 'pack', title: 'Рюкзак', kind: 'other', size: [3, 3], mass: 1.5, value: 2000,
                   wear: 'pack', carry_bonus: 12 });
    return items;
}

test('normalizeItem: размер, вид и слоты', () => {
    const it = normalizeItem({ id: 'x', size: [6, 2], kind: 'weapon', wear: 'back', mass: 1.5 });
    eq(it.w, 6); eq(it.h, 2);
    eq(it.kind, 'weapon');
    eq(it.wear, 'back');
    near(it.mass, 1.5, 1e-9);
    eq(normalizeItem({ id: 'y' }).w, 1, 'размер по умолчанию 1×1');
    eq(normalizeItem({ id: 'z', kind: 'чушь' }).kind, 'other', 'неизвестный вид — other');
    eq(normalizeItem(null), null);
    eq(normalizeItem({}), null, 'без id предмета нет');
    eq(normalizeItem({ id: 'n', size: [0, -5] }).w, 1, 'нулевой размер поднимается до 1');
});

test('createGrid/canPlace: границы и занятость', () => {
    const grid = createGrid(4, 3);
    eq(grid.cols, 4); eq(grid.rows, 3);
    truthy(canPlace(grid, 0, 0, 4, 3));
    falsy(canPlace(grid, 2, 0, 4, 1), 'выход за правую границу');
    falsy(canPlace(grid, 0, 2, 1, 2), 'выход за низ');
    falsy(canPlace(grid, -1, 0, 1, 1), 'отрицательная координата');
    fillCells(grid, 1, 1, 2, 1, 'ak');
    falsy(canPlace(grid, 1, 1, 1, 1));
    falsy(canPlace(grid, 0, 1, 2, 1), 'пересечение занятой клетки');
    truthy(canPlace(grid, 0, 0, 2, 1), 'свободно рядом');
});

test('findPlace: сверху вниз и слева направо', () => {
    const grid = createGrid(4, 3);
    eq(JSON.stringify(findPlace(grid, 2, 2)), '{"x":0,"y":0}');
    fillCells(grid, 0, 0, 2, 2, 'a');
    eq(JSON.stringify(findPlace(grid, 2, 2)), '{"x":2,"y":0}');
    fillCells(grid, 2, 0, 2, 2, 'b');
    eq(findPlace(grid, 2, 2), null, 'в 4×3 для 2×2 после двух блоков места нет');
    eq(JSON.stringify(findPlace(grid, 1, 1)), '{"x":0,"y":2}', 'клетка в нижней строке свободна');
    eq(findPlace(grid, 4, 4), null, 'не помещается — null');
});

test('инвентарь: укладка с размером и стопки', () => {
    const inv = createInventory({ cols: 6, rows: 4, defs: defs() });
    eq(inv.add('ak', 1), 1);
    const list = inv.list();
    eq(list[0].x, 0); eq(list[0].y, 0);
    eq(list[0].w, 6); eq(list[0].h, 2);
    // Следующий предмет ложится ниже автомата (он занял две строки).
    eq(inv.add('pistol', 1), 1);
    const pistol = inv.list().find((e) => e.id === 'pistol');
    eq(pistol.y, 2);
    // Стопки: аптечки складываются в одну.
    inv.add('medkit', 5);
    const meds = inv.list().filter((e) => e.id === 'medkit');
    eq(meds.length, 2, 'пять аптечек при stack 3 — две стопки');
    eq(inv.count('medkit'), 5);
});

test('инвентарь: не влезает — кладёт сколько может', () => {
    const inv = createInventory({ cols: 2, rows: 1, defs: defs() });
    eq(inv.add('ak', 1), 0, 'автомат в 2×1 не влезает');
    eq(inv.list().length, 0);
    // Стопка — 60: 100 патронов лягут как 60 + 40 (обе клетки сетки).
    eq(inv.add('ammo', 100), 100, 'патроны разместились двумя стопками');
    eq(inv.count('ammo'), 100);
    const ammoStacks = inv.list().filter((e) => e.id === 'ammo').map((e) => e.count);
    eq(ammoStacks.join('+'), '60+40', 'стопки по stack');
});

test('инвентарь: remove освобождает клетки и снимает надетое', () => {
    // Автомат занимает 6×2, поэтому сетка должна быть не меньше.
    const inv = createInventory({ cols: 6, rows: 4, defs: defs() });
    inv.add('ak', 1);
    eq(inv.remove('ak', 1), 1);
    eq(inv.count('ak'), 0);
    eq(inv.list().length, 0);
    // Место освободилось: второй автомат влезает на то же место.
    eq(inv.add('ak', 1), 1);
    // Надетое считается в контейнере и снимается первым. Начинаем с чистой
    // сетки: жилет 2×2, а автомат уже занял шесть клеток.
    const inv2 = createInventory({ cols: 6, rows: 4, defs: defs() });
    inv2.add('vest', 1);
    eq(inv2.wear('vest'), 'vest', 'жилет надет');
    eq(inv2.count('vest'), 1, 'надетое считается');
    eq(inv2.remove('vest', 1), 1, 'снятие надетого');
    eq(inv2.count('vest'), 0);
    eq(inv2.wornList().armor, undefined, 'слот освободился');
});

test('инвентарь: масса, ёмкость и перегруз', () => {
    const inv = createInventory({ cols: 8, rows: 6, capacity: 20, defs: defs() });
    inv.add('ak', 1);
    near(inv.mass(), 3.8, 1e-6);
    falsy(inv.overloaded());
    inv.add('vest', 1);
    inv.wear('vest');
    near(inv.mass(), 7.8, 1e-6, 'масса с надетым');
    // Рюкзак даёт +12 кг: предел остаётся 20, а переносимый вес — 32.
    inv.add('pack', 1);
    inv.wear('pack');
    near(inv.capacity(), 20, 1e-6, 'предел не меняется от надетого');
    near(inv.carryBonus(), 12, 1e-6, 'бонус переноса от рюкзака');
    near(inv.carryLimit(), 32, 1e-6, 'переносимый вес = предел + бонус');
    near(inv.mass(), 9.3, 1e-6);
    // Перегруз: предел ставим ОТ фактической массы, чтобы тест не зависел от
    // того, сколько стволов влезло в сетку.
    const mass = inv.mass();
    truthy(mass > 6, `масса растёт: ${mass.toFixed(1)} кг`);
    // Легко: предел 20 плюс 12 от рюкзака = 32 при массе 9.3.
    falsy(inv.overloaded(), 'в пределах переносимого');
    // Убираем рюкзак — переносимый вес падает до 20, и предел можно задать точно.
    inv.unwear('pack');
    inv.setCapacity(5);
    near(inv.capacity(), 5, 1e-6, 'предел задан числом');
    truthy(inv.overloaded(), `предел 5 < массы ${mass.toFixed(1)} — перегруз`);
    inv.setCapacity(0);
    falsy(inv.overloaded(), 'без предела перегруза нет');
    // Базовая масса контейнера входит в общий вес.
    const stand = createInventory({ cols: 4, rows: 4, defs: defs() });
    stand.add('medkit', 1);
    const without = stand.mass();
    stand.setBaseMass(5);
    near(stand.mass(), without + 5, 1e-6, 'базовая масса учтена');
});

test('инвентарь: надевание и снятие по слотам', () => {
    const inv = createInventory({ cols: 6, rows: 6, defs: defs() });
    inv.add('vest', 1);
    inv.add('pack', 1);
    eq(inv.wear('vest'), 'vest', 'жилет надет');
    eq(inv.wear('pack'), 'pack', 'рюкзак надет');
    eq(JSON.stringify(inv.wornList()), '{"armor":"vest","pack":"pack"}');
    eq(inv.armorClass(), 3);
    eq(inv.armorClass('armor'), 3);
    eq(inv.armorClass('helmet'), 0, 'пустой слот — не броня');
    eq(inv.count('vest'), 1, 'надетое считается в контейнере');

    // Снятие возвращает предмет в контейнер.
    eq(inv.unwear('armor'), 'vest');
    eq(inv.wornList().armor, undefined, 'слот пуст');
    eq(inv.count('vest'), 1);
    eq(inv.armorClass(), 0);

    // Надевание того же слота меняет предмет: прежний возвращается.
    inv.add('vest', 1);
    eq(inv.wear('vest'), 'vest', 'второй жилет надет');
    eq(inv.wornList().armor, 'vest');
    // Одна копия в слоте, одна вернулась в контейнер — итого две.
    eq(inv.count('vest'), 2, 'надетый плюс вернувшийся');

    // Несуществующее и неносовое не надеваются.
    eq(inv.wear('нет-такого'), null);
    inv.add('medkit', 1);
    eq(inv.wear('medkit'), null, 'аптечка не надевается');
});

test('инвентарь: fits предсказывает место', () => {
    const inv = createInventory({ cols: 2, rows: 1, defs: defs() });
    truthy(inv.fits('ammo', 60), 'одна стопка влезает');
    falsy(inv.fits('ak', 1), 'автомат 6×2 в 2×1 не влезает');
    inv.add('ammo', 60);
    truthy(inv.fits('ammo', 1), 'вторая стопка влезает во вторую клетку');
    inv.add('ammo', 60);
    falsy(inv.fits('ammo', 1), 'обе клетки заняты');
});

test('инвентарь: save/load и repack', () => {
    const inv = createInventory({ cols: 6, rows: 4, defs: defs() });
    inv.add('medkit', 4);
    inv.add('ammo', 120);
    inv.addMoney(500);
    const data = JSON.parse(JSON.stringify(inv.save()));
    eq(data.money, 500);
    const restored = createInventory({ cols: 6, rows: 4, defs: defs() });
    restored.load(data);
    eq(restored.count('medkit'), 4);
    eq(restored.count('ammo'), 120);
    eq(restored.money, 500);
    truthy(restored.list().every((e) => e.x >= 0 && e.y >= 0), 'всё уложено');
    restored.repack();
    eq(restored.count('medkit'), 4, 'repack сохраняет содержимое');
});

test('инвентарь: value и сортировка по ценности', () => {
    const inv = createInventory({ cols: 8, rows: 6, defs: defs() });
    inv.add('medkit', 2);
    inv.add('ak', 1);
    eq(inv.value(), 9000 + 600);
    inv.sortByValue();
    eq(inv.list()[0].id, 'ak', 'дорогое наверху');
});

test('items.load: пачка и { items: [...] }', () => {
    const items = createItems();
    eq(items.load([{ id: 'a' }, { id: 'b' }]), 2);
    eq(items.ids().length, 2);
    eq(items.load({ items: [{ id: 'c' }] }), 1);
    truthy(items.has('c'));
    eq(items.get('нет'), null);
    eq(items.remove('a'), true);
    falsy(items.has('a'));
});

finish();
