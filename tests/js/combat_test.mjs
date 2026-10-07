// ===========================================================================
// Юнит-тесты боевой модели (src/highlevel/combat.js) без движка.
//
// Проверяем то, что легко сломать: зоны и смерть, кровь по порогу, чёрные
// конечности и их дебаффы, лечение чёрного аптечкой, броню и расчёт урона.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/combat_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    createHealth, damageFor, zoneForSlot, armorBlock, applyArmor,
    ZONES, MAX_HP, LETHAL, BLEED_THRESHOLD, BLACKED,
} from '../../src/highlevel/combat.js';

test('createHealth: зоны начинаются с максимума', () => {
    const hp = createHealth();
    for (const zone of ZONES) eq(hp.get(zone), MAX_HP[zone], `зона ${zone}`);
    eq(hp.dead, false);
    eq(hp.total(), MAX_HP.arms + MAX_HP.stomach + MAX_HP.legs, 'сумма без смертельных');
    eq(hp.sum(), MAX_HP.head + MAX_HP.chest + MAX_HP.arms + MAX_HP.stomach + MAX_HP.legs,
       'полная сумма по всем зонам');
    eq(hp.fraction(), 1);
});

test('hit: урон вычитается из своей зоны', () => {
    const hp = createHealth();
    const total_before = hp.sum();
    const r = hp.hit('chest', 40);
    eq(hp.get('chest'), MAX_HP.chest - 40);
    eq(r.died, false);
    eq(r.amount, 40);
    eq(hp.get('head'), MAX_HP.head, 'другие зоны не тронуты');
    eq(hp.sum(), total_before - 40, 'полная сумма двигается от попадания в грудь');
    truthy(hp.fraction() < 1, 'доля здоровья упала');
});

test('hit: ноль в голове или груди — смерть, и только один раз', () => {
    const deaths = [];
    const hp = createHealth({ onDeath: (info) => deaths.push(info.cause) });
    const r = hp.hit('head', MAX_HP.head);
    eq(r.died, true);
    truthy(hp.dead);
    eq(hp.deathCause, 'head');
    eq(deaths.join(','), 'head');
    const again = hp.hit('chest', 80);
    eq(again.died, false, 'после смерти урона нет');
    eq(deaths.length, 1, 'смерть приходит один раз');
});

test('hit: ноль в конечности — «чёрная», а не смерть', () => {
    const blacked = [];
    const hp = createHealth({ onBlacked: (info) => blacked.push(info.zone) });
    const r = hp.hit('legs', MAX_HP.legs);
    eq(r.died, false);
    eq(r.blacked, true);
    truthy(hp.blacked('legs'));
    eq(blacked.join(','), 'legs');
    eq(hp.blackedZones().join(','), 'legs');
    eq(hp.dead, false);
});

test('чёрные конечности дают дебаффы, здоровые — нет', () => {
    const hp = createHealth();
    eq(hp.aimPenalty(), 1);
    eq(hp.reloadPenalty(), 1);
    eq(hp.speedMultiplier(), 1);
    eq(hp.jumpMultiplier(), 1);
    hp.hit('arms', MAX_HP.arms);
    hp.hit('legs', MAX_HP.legs);
    near(hp.aimPenalty(), BLACKED.aim, 1e-9);
    near(hp.reloadPenalty(), BLACKED.reload, 1e-9);
    near(hp.speedMultiplier(), BLACKED.speed, 1e-9);
    near(hp.jumpMultiplier(), BLACKED.jump, 1e-9);
});

test('кровотечение: сильное попадание в руку, живот или ногу', () => {
    const hp = createHealth();
    hp.hit('arms', BLEED_THRESHOLD - 1);
    falsy(hp.isBleeding('arms'), 'слабое попадание не кровит');
    hp.hit('arms', BLEED_THRESHOLD);
    truthy(hp.isBleeding('arms'));
    // Голова и грудь не кровят: там сразу смерть или ничего.
    const fatal = createHealth();
    fatal.hit('chest', 5);
    falsy(fatal.isBleeding('chest'));
});

test('tick: кровь тикает и может почернить зону', () => {
    const hp = createHealth();
    hp.hit('stomach', 50);
    truthy(hp.isBleeding('stomach'));
    const before = hp.get('stomach');
    hp.tick(1.0);
    const after = hp.get('stomach');
    near(before - after, 1.0, 1e-6, 'секунда крови — 1 HP');
    hp.tick(100);
    eq(hp.get('stomach'), 0, 'кровь доконала зону');
    truthy(hp.blacked('stomach'));
    falsy(hp.dead, 'живот не смертелен');
});

test('tick: доли времени не теряются', () => {
    const hp = createHealth();
    hp.hit('legs', 30);
    const after_hit = hp.get('legs');
    for (let i = 0; i < 60; ++i) hp.tick(1 / 60);
    near(hp.get('legs'), after_hit - 1.0, 0.2, 'за 60 кадров потеряна примерно 1 HP');
});

test('heal: аптечка поднимает и чёрную конечность', () => {
    const hp = createHealth();
    hp.hit('arms', MAX_HP.arms + 10);
    truthy(hp.blacked('arms'));
    const healed = hp.heal('arms', 20);
    eq(healed, 20, 'вылечено ровно сколько просили');
    eq(hp.get('arms'), 20);
    falsy(hp.blacked('arms'), 'чёрная стала обычной');
    eq(hp.heal('arms', 999), MAX_HP.arms - 20, 'выше максимума не лечит');
    eq(hp.heal('head', 10), 0, 'мёртвого не лечат');
});

test('stopBleeding: останавливает кровь во всех зонах', () => {
    const hp = createHealth();
    hp.hit('arms', 40);
    hp.hit('legs', 40);
    eq(hp.bleeding().length, 2);
    eq(hp.stopBleeding(), 2);
    eq(hp.anyBleeding(), false);
    eq(hp.stopBleeding(), 0, 'повторно останавливать нечего');
});

test('save/load: состояние переживает запись', () => {
    const hp = createHealth();
    hp.hit('chest', 30);
    hp.hit('arms', 40);
    const data = JSON.parse(JSON.stringify(hp.save()));
    const restored = createHealth();
    restored.load(data);
    eq(restored.get('chest'), MAX_HP.chest - 30);
    eq(restored.get('arms'), MAX_HP.arms - 40);
    truthy(restored.isBleeding('arms'));
    falsy(restored.dead);
});

test('reset: возвращает всё здоровье', () => {
    const hp = createHealth();
    hp.hit('head', 999);
    truthy(hp.dead);
    hp.reset();
    falsy(hp.dead);
    eq(hp.get('head'), MAX_HP.head);
    eq(hp.bleeding().length, 0);
});

test('damageFor: (оружие + часть) × 1.35', () => {
    // Голова: добавка 30, грудь 10, руки и ноги 6; неизвестное считаем грудью.
    eq(damageFor(35, 'head'), 88, 'автомат в голову');
    eq(damageFor(35, 'chest'), 61, 'автомат в грудь');
    eq(damageFor(20, 'arms'), 35, 'пистолет в руку');
    eq(damageFor(35, 'неизвестно'), 61, 'неизвестное — грудь');
    eq(damageFor(-5, 'head'), 41, 'отрицательное оружие не проходит');
});

test('zoneForSlot: слоты рига сводятся к пяти зонам', () => {
    eq(zoneForSlot('head'), 'head');
    eq(zoneForSlot('HEAD'), 'head', 'регистр не важен');
    eq(zoneForSlot('arm_forearm_front'), 'arms');
    eq(zoneForSlot('hand_front'), 'arms');
    eq(zoneForSlot('leg_thigh_back'), 'legs');
    eq(zoneForSlot('foot_front'), 'legs');
    eq(zoneForSlot('stomach'), 'stomach');
    eq(zoneForSlot('torso_front'), 'chest');
    eq(zoneForSlot('неизвестный_слот'), 'chest', 'неизвестное — грудь');
    eq(zoneForSlot(''), 'chest');
});

test('armorBlock и applyArmor: класс держит долю, прочность тратится', () => {
    eq(armorBlock(0), 0);
    near(armorBlock(1), 0.15, 1e-9);
    near(armorBlock(6), 0.7, 1e-9);
    near(armorBlock(99), 0.7, 1e-9, 'выше шестого класса не бывает');
    const full = applyArmor(100, 3, 100, 100);
    near(full.damage, 100 - 100 * 0.36, 1e-6);
    near(full.blocked, 36, 1e-6);
    near(full.spent, 100, 1e-6, 'прочность тает');
    const broken = applyArmor(100, 3, 0, 100);
    near(broken.damage, 100, 1e-6, 'убитая броня не держит');
    near(applyArmor(100, 0, 100, 100).damage, 100, 1e-6, 'без брони урон полный');
});

test('hit с бронёй: часть урона держит, прочность тратится', () => {
    let spent = 0;
    const hp = createHealth();
    const r = hp.hit('chest', 50, {
        armor: {
            class: 3, durability: 100, maxDurability: 100,
            spend: (amount) => { spent += amount; },
        },
    });
    near(r.blocked, 50 * 0.36, 1e-6);
    near(r.amount, 50 - 50 * 0.36, 1e-6);
    near(hp.get('chest'), MAX_HP.chest - r.amount, 1e-6);
    near(spent, 50, 1e-6, 'прочность потрачена');
});

test('hitSlot: выстрел по слоту переводится в зону и получает добавку', () => {
    const hp = createHealth();
    const r = hp.hitSlot('arm_hand_back', 30);
    eq(r.zone, 'arms');
    truthy(r.amount > 30, 'часть тела добавила урон');
    near(r.amount, damageFor(30, 'arms'), 1e-9);
    truthy(hp.get('arms') < MAX_HP.arms);
});

test('report: читаемая строка состояния', () => {
    const hp = createHealth();
    hp.hit('arms', MAX_HP.arms);
    hp.hit('legs', 40);
    const text = hp.report();
    truthy(text.includes('Руки'), 'есть название зоны');
    truthy(text.includes('чёрная'), 'помечена чёрная конечность');
    truthy(text.includes('кровь'), 'помечено кровотечение');
});

finish();
