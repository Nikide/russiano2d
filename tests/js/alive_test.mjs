// ===========================================================================
// Юнит-тесты психики NPC и режиссёра рейда (src/highlevel/alive.js).
//
// Проверяем то, что легко сломать: вывод OCEAN и роли из черт, спайки по
// акцентуации, затухание страха и пульс по Гроссману, срывы и их веса,
// моральную травму с полом черт, память между рейдами, фазы режиссёра.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/alive_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    createPsyche, createDirector, normalizeSpec, makeBias, kitScore, pickHunter,
    moveToward, clamp, PULSE_REST, PULSE_MAX, PULSE_TUNNEL, BREAK_STRESS,
    TRAIT_NAMES, TRAIT_DEFAULTS, TYPE_BIAS, BREAK_KINDS, BREAK_TIME,
    TRAUMA_FLOOR, knobsFor, PHASES, FACE_TO_FACE,
} from '../../src/highlevel/alive.js';

test('clamp и moveToward: границы и шаг', () => {
    eq(clamp(5, 0, 1), 1);
    eq(clamp(-5, 0, 1), 0);
    eq(clamp('чушь', 2, 3), 2, 'не число — нижняя граница');
    eq(moveToward(0, 10, 3), 3);
    eq(moveToward(9, 10, 3), 10, 'доходит точно');
    eq(moveToward(10, 0, 3), 7);
});

test('normalizeSpec: короткая форма и черты', () => {
    const a = normalizeSpec('veteran');
    eq(a.type, 'veteran');
    eq(a.traits.skill, TRAIT_DEFAULTS.skill, 'без явного skill — из черт');
    const b = normalizeSpec({ type: 'rookie', traits: { empathy: 0.9 }, skill: 0.8 });
    eq(b.type, 'rookie');
    near(b.traits.empathy, 0.9, 1e-9);
    near(b.skill, 0.8, 1e-9);
    eq(normalizeSpec({ type: 'rookie', traits: { morale: -5 } }).traits.morale, -1, 'мораль ограничена снизу');
    eq(normalizeSpec({ type: 'rookie', traits: { empathy: 5 } }).traits.empathy, 1, 'черта ограничена сверху');
    eq(normalizeSpec({}).type, '');
    eq(normalizeSpec(null).type, '');
});

test('makeBias: акцентуация психотипа', () => {
    const traits = Object.assign({}, TRAIT_DEFAULTS);
    const stoic = makeBias('stoic', traits, 0.5);
    const panicker = makeBias('panicker', traits, 0.5);
    truthy(panicker.fg > stoic.fg, 'паникёр копит страх быстрее стоика');
    const berserker = makeBias('berserker', traits, 0.5);
    truthy(berserker.rg > stoic.rg, 'берсерк ярится сильнее');
    eq(berserker.br.join(','), TYPE_BIAS.berserker.br.join(','), 'веса срывов из таблицы');
    const unknown = makeBias('нет-такого', traits, 0.5);
    eq(unknown.br.join(','), '1,1,1,1,1', 'без психотипа — ровные веса');
});

test('OCEAN выводится из черт', () => {
    const fearful = createPsyche({ type: '', traits: { fear: 1, jumpiness: 1, madness: 1, patience: 0 } });
    const calm = createPsyche({ type: '', traits: { fear: 0, jumpiness: 0, madness: 0, patience: 1 } });
    truthy(fearful.neuroticism > calm.neuroticism, 'невротизм из страха и суетности');
    const social = createPsyche({ type: '', traits: { sociability: 1, talkativeness: 1, aggression: 1 } });
    truthy(social.extraversion > 0.5, 'экстраверсия из общительности');
    const given = createPsyche({ type: '', neuroticism: 0.1, extraversion: 0.9 });
    near(given.neuroticism, 0.1, 1e-9);
    near(given.extraversion, 0.9, 1e-9);
});

test('роль: лидер по психотипу и тренированности', () => {
    eq(createPsyche({ type: 'veteran', skill: 0.8 }).role, 'leader');
    eq(createPsyche({ type: 'veteran', skill: 0.3 }).role, 'solo');
    eq(createPsyche({ type: 'rookie', skill: 0.9 }).role, 'solo', 'не всякий тренированный лидер');
    eq(createPsyche({ type: 'rookie', skill: 0.2, squadId: 4 }).role, 'follower');
    eq(createPsyche({ type: 'rookie', leader: true }).role, 'leader', 'явная метка');
    const lead = createPsyche({ type: 'officer', skill: 0.9 });
    truthy(lead.leadership() > 0.5, `качество лидера: ${lead.leadership().toFixed(2)}`);
    const follower = createPsyche({ type: 'rookie', skill: 0 });
    truthy(lead.leadership() > follower.leadership(), 'офицер лучше ведёт');
});

test('спайк страха: тренированный и стойкий копят медленнее', () => {
    const rookie = createPsyche({ type: 'rookie', traits: { skill: 0.1, morale: 0 } });
    const vet = createPsyche({ type: 'veteran', traits: { skill: 0.9, morale: 0.8 } });
    const a = rookie.fearSpike(0.5);
    const b = vet.fearSpike(0.5);
    truthy(a > b, `новичок боится сильнее: ${a.toFixed(3)} > ${b.toFixed(3)}`);
    truthy(rookie.stress > 0, 'страх копит стресс');
    near(rookie.stress, a * 0.85, 1e-9, 'стресс — доля спайка');
});

test('ранение: страх, ярость, пульс, подавление', () => {
    const m = createPsyche({ type: 'epileptoid' });
    m.onHurt(0.5, false);
    truthy(m.fear > 0, 'страх вырос');
    truthy(m.rage > 0, 'эпилептоид ярится от раны');
    truthy(m.pulse > PULSE_REST, 'пульс поднялся');
    truthy(m.suppression > 0, 'подавление выросло');
    const light = createPsyche({ type: 'worker' });
    light.onHurt(0.01, false);
    truthy(light.fear > 0, 'даже лёгкое ранение пугает (минимум 0.05)');
});

test('смерть союзника: лидер и ведомый реагируют по-разному', () => {
    const leader = createPsyche({ type: 'veteran', skill: 0.8 });
    const follower = createPsyche({ type: 'rookie', skill: 0.2, squadId: 1 });
    eq(leader.role, 'leader');
    eq(follower.role, 'follower');
    const l = leader.onAllyDown(false);
    const f = follower.onAllyDown(true);
    truthy(f > l, `ведомый без лидера сыпется сильнее: ${f.toFixed(3)} > ${l.toFixed(3)}`);
    eq(follower.leaderDowns, 1);
    truthy(follower.moralInjury > 0, 'травма копится');
    leader.onLeaderBroken();
    eq(leader.leaderDowns, 0, 'сам лидер на своё «сломался» не реагирует');
    follower.onLeaderBroken();
    eq(follower.leaderDowns, 2);
});

test('взрыв: вблизи глушит и пугает сильнее', () => {
    const near = createPsyche({ type: 'worker' });
    const far = createPsyche({ type: 'worker' });
    near.onExplosion(20, 1);
    far.onExplosion(400, 1);
    truthy(near.fear > far.fear, 'у эпицентра страшнее');
    truthy(near.deafness > far.deafness, 'вблизи глохнут');
    truthy(near.pulse > far.pulse, 'пульс выше');
});

test('пуля рядом и окружение: спайк только когда кольцо сжимается', () => {
    const m = createPsyche({ type: 'worker' });
    m.onNearMiss(2);
    truthy(m.fear > 0);
    truthy(m.suppression > 0);
    const before = m.fear;
    m.onSurrounded(3);
    truthy(m.fear > before, 'взяли в клещи — страх вырос');
    const after = m.fear;
    m.onSurrounded(3);
    near(m.fear, after, 1e-9, 'то же кольцо не копит страх второй раз');
    m.onSurrounded(1);
    m.onSurrounded(4);
    truthy(m.fear > after, 'кольцо сжалось — спайк');
});

test('убийство: барьер убийства и фазы переживания', () => {
    const empathic = createPsyche({ type: 'medic', traits: { empathy: 1, madness: 0 } });
    const killer = createPsyche({ type: 'sadist', traits: { empathy: 0, madness: 1 } });
    empathic.onKill(true);
    killer.onKill(true);
    truthy(empathic.moralInjury > killer.moralInjury, 'эмпат травмируется сильнее');
    truthy(empathic.fear > killer.fear, 'в упор эмпату тяжелее');
    eq(empathic.killPhase, 'euphoria', 'первое убийство — эйфория');
    eq(killer.killPhase, 'euphoria');
    // Первое убийство эмпата в упор → позже вырвет (через отрицание).
    truthy(empathic.vomitPending, 'отвращение отложено');
    empathic.tick(5, {});
    eq(empathic.killPhase, 'denial', 'отрицание после эйфории');
    truthy(empathic.killPhaseLeft > 0, 'фаза отрицания длится');
    // Отрицание кончилось — наступает раскаяние, и эмпата выворачивает.
    // Тикаем мелкими шагами: один большой шаг отсчитал бы срыв в том же
    // вызове, и состояние снова оказалось бы пустым.
    for (let i = 0; i < 100 && empathic.killPhase !== 'remorse'; ++i) empathic.tick(0.2, {});
    eq(empathic.killPhase, 'remorse', 'раскаяние после отрицания');
    eq(empathic.breakState, 'vomit', 'срыв-отвращение сразу после отрицания');
    eq(empathic.breaks, 1);
    for (let i = 0; i < 100 && empathic.isBroken(); ++i) empathic.tick(0.1, {});
    falsy(empathic.isBroken(), 'отвращение проходит');
    // Издалека страх притупляется.
    const far = createPsyche({ type: 'worker' });
    far.onNearMiss(2);
    const fearBefore = far.fear;
    far.onKill(false);
    truthy(far.fear < fearBefore, 'издалека страх спадает');
});

test('пульс: разгоняется к цели и тормозит тахикардию', () => {
    const m = createPsyche({ type: 'worker' });
    m.fearSpike(0.9);
    for (let i = 0; i < 60; ++i) m.tick(0.1, {});
    truthy(m.pulse > PULSE_REST + 20, `пульс поднялся: ${Math.round(m.pulse)}`);
    truthy(m.pulse <= PULSE_MAX, 'не выше предела');
    // Без стресса пульс возвращается к покою.
    const calm = createPsyche({ type: 'stoic', traits: { skill: 1, morale: 1 } });
    calm.fearSpike(0.2);
    for (let i = 0; i < 200; ++i) calm.tick(0.1, {});
    truthy(calm.pulse < PULSE_REST + 20, `стоик остывает: ${Math.round(calm.pulse)}`);
});

test('лидер рядом успокаивает, без лидера ведомый сыпется', () => {
    const withLeader = createPsyche({ type: 'rookie', squadId: 1, traits: { skill: 0.2 } });
    const alone = createPsyche({ type: 'rookie', squadId: 1, traits: { skill: 0.2 } });
    withLeader.fearSpike(0.6);
    alone.fearSpike(0.6);
    for (let i = 0; i < 20; ++i) {
        withLeader.tick(0.2, { leaderNear: true });
        alone.tick(0.2, {});
    }
    truthy(withLeader.fear < alone.fear, `с лидером спокойнее: ${withLeader.fear.toFixed(3)} < ${alone.fear.toFixed(3)}`);
});

test('эффекты Гроссмана: пульс выше 140 сужает обзор и слух', () => {
    const m = createPsyche({ type: 'worker' });
    near(m.overload(), 0, 1e-9, 'в покое перегрузки нет');
    near(m.visionConeMult(), 1, 1e-9);
    m.pulseSpike(PULSE_TUNNEL - PULSE_REST + 10);
    truthy(m.pulse > PULSE_TUNNEL, 'пульс выше порога');
    truthy(m.overload() > 0, 'перегрузка есть');
    truthy(m.visionConeMult() < 1, 'зрение сузилось');
    truthy(m.hearingMult() < 1, 'слух притупился');
    truthy(m.aimErrorMult() > 1, 'прицел сбит');
    truthy(m.tremorMult() > 1, 'руки дрожат');
    truthy(m.reloadMult() > 1, 'перезарядка медленнее');
    truthy(m.reactionMult() > 1, 'реакция медленнее');
});

test('глухота после взрыва притупляет слух и проходит', () => {
    const m = createPsyche({ type: 'worker' });
    m.onExplosion(0, 2);
    const deaf = m.hearingMult();
    for (let i = 0; i < 200; ++i) m.tick(0.1, {});
    truthy(m.hearingMult() > deaf, 'слух возвращается');
});

test('ступор лицом к лицу и барьер убийства', () => {
    const scared = createPsyche({ type: 'panicker', traits: { fear: 1 } });
    scared.fearSpike(1);
    const close = scared.freezeChance(20);
    const far = scared.freezeChance(FACE_TO_FACE + 100);
    truthy(close > far, `в упор ступор вероятнее: ${close.toFixed(3)} > ${far.toFixed(3)}`);
    eq(far, 0, 'издалека ступора нет');
    const empath = createPsyche({ type: 'medic', traits: { empathy: 1, aggression: 0, madness: 0, skill: 0 } });
    const killer = createPsyche({ type: 'sadist', traits: { empathy: 0, aggression: 1, madness: 1, skill: 1 } });
    truthy(empath.killingHesitation(20) > killer.killingHesitation(20), 'эмпат медлит в упор');
    eq(empath.killingHesitation(9999), 0, 'издалека барьера нет');
});

test('срыв: порог стресса, длительность и опустошение', () => {
    const m = createPsyche({ type: 'panicker', seed: 5 });
    eq(m.checkBreak(), '', 'на спокойном стресса нет');
    m.addStress(BREAK_STRESS + 0.2);
    truthy(m.breakChance() > 0.05, `шанс срыва: ${m.breakChance().toFixed(2)}`);
    const kind = m.checkBreak();
    truthy(kind === '' || BREAK_KINDS.concat(['vomit']).indexOf(kind) >= 0, `вид срыва: ${kind}`);
    truthy(kind !== '', 'порог стресса даёт срыв (сид подобран)');
    truthy(m.isBroken(), 'срыв начался');
    truthy(m.breakTitle().length > 0, 'у срыва есть название');
    near(m.breakLeft, BREAK_TIME[kind], 1e-9, 'длительность по виду');
    const fearBefore = m.fear;
    // Тикаем короткими шагами: один большой шаг сначала завершил бы срыв, а
    // потом тут же отсчитал его заново — и проверки теряли состояние.
    for (let i = 0; i < 200 && m.isBroken(); ++i) m.tick(0.1, {});
    falsy(m.isBroken(), 'срыв заканчивается сам');
    truthy(m.fear < fearBefore, 'после срыва опустошение');
    truthy(m.breakCooldown > 0, 'повторной проверки нет');
    eq(m.checkBreak(), '', 'в откате срыва не будет');
    for (let i = 0; i < 200; ++i) m.tick(0.1, {});   // откат кончился
    eq(m.breakCooldown, 0, 'откат истекает');
});

test('срыв: во время срыва повторного нет, endBreak досрочно', () => {
    const m = createPsyche({ type: 'rookie', seed: 2 });
    m.forceBreak('panic');
    eq(m.breakState, 'panic');
    truthy(m.pulse >= 175, 'паника гонит пульс');
    m.addStress(1);
    eq(m.checkBreak(), '', 'срыв уже идёт');
    eq(m.endBreak(), 'panic');
    falsy(m.isBroken());
    truthy(m.fatigue > 0, 'после срыва усталость');
});

test('веса срывов: лидер не бежит, вымотанный смотрит в пустоту', () => {
    const leader = createPsyche({ type: 'veteran', skill: 0.9, leader: true });
    const follower = createPsyche({ type: 'rookie', skill: 0.2, squadId: 1 });
    follower.onAllyDown(true);
    const lw = leader.breakWeights();
    const fw = follower.breakWeights();
    truthy(lw[1] > lw[0] || lw[3] < fw[3], 'лидер не бежит и не сдаётся');
    truthy(fw[0] > 1, 'ведомый без лидера склонен к панике');
    const tired = createPsyche({ type: 'worker' });
    tired.carryMoralInjury(1);
    for (let i = 0; i < 400; ++i) tired.tick(0.1, {});
    truthy(tired.breakWeights()[5] > 0.5, `CSR у вымотанного травмой: ${tired.breakWeights()[5].toFixed(2)}`);
});

test('веса срывов: страх и ярость сдвигают выбор', () => {
    const calm = createPsyche({ type: 'worker' });
    const scared = createPsyche({ type: 'worker' });
    scared.fearSpike(1);
    truthy(scared.breakWeights()[0] > calm.breakWeights()[0], 'в страхе вероятнее паника');
    const angry = createPsyche({ type: 'worker' });
    angry.rageSpike(1);
    truthy(angry.breakWeights()[1] > calm.breakWeights()[1], 'в ярости вероятнее ярость');
});

test('моральная травма: пол черт и память между рейдами', () => {
    const m = createPsyche({ type: 'medic', traits: { empathy: 1, madness: 0 } });
    m.carryMoralInjury(1);
    near(m.greedMult(), TRAUMA_FLOOR, 1e-9, 'жадность не падает ниже пола');
    near(m.cautionMult(), TRAUMA_FLOOR, 1e-9, 'осторожность тоже');
    near(m.anhedonia(), 1, 1e-9, 'ангедония на максимуме');
    const light = createPsyche({ type: 'worker' });
    light.carryMoralInjury(0.1);
    truthy(light.greedMult() > 0.9, 'лёгкая травма почти не мешает');
    // Сброс нервов память не стирает.
    light.carryMoralInjury(0.8);
    light.onHurt(0.5, true);
    light.resetDynamic();
    near(light.moralInjury, 0.8, 1e-9, 'травма переживает сброс');
    eq(light.fear, 0, 'нервы сброшены');
});

test('голод и холод копятся, холод только ночью', () => {
    const day = createPsyche({ type: 'worker' });
    const night = createPsyche({ type: 'worker' });
    night.night(true);
    truthy(night.night(), 'ночь включена');
    for (let i = 0; i < 100; ++i) {
        day.tick(1, {});
        night.tick(1, {});
    }
    truthy(day.hunger > 0, 'голод растёт всегда');
    truthy(night.cold > 0, 'ночью холодно');
    truthy(night.cold > day.cold, 'днём холод уходит');
    eq(day.cold, 0, 'день не морозит');
});

test('save/load: нервы и травма переживают запись', () => {
    const m = createPsyche({ type: 'veteran', skill: 0.8 });
    m.onHurt(0.6, true);
    m.onKill(true);
    const data = JSON.parse(JSON.stringify(m.save()));
    const restored = createPsyche({ type: 'rookie' });
    restored.load(data);
    eq(restored.role, m.role);
    near(restored.fear, m.fear, 1e-9);
    near(restored.moralInjury, m.moralInjury, 1e-9);
    eq(restored.kills, 1);
    truthy(restored.isLeader(), 'роль восстановлена');
});

test('stateLine: читаемая строка состояния', () => {
    const m = createPsyche({ type: 'officer', skill: 0.9 });
    m.onHurt(0.5, false);
    m.forceBreak('panic');
    const line = m.stateLine();
    truthy(line.includes('officer'), line);
    truthy(line.includes('лидер'), 'лидер отмечен');
    truthy(line.includes('паника'), 'срыв отмечен');
    truthy(line.includes('страх'), 'есть страх');
});

// --- Режиссёр рейда ---

test('режиссёр: фазы по времени и ценности рюкзака', () => {
    const dir = createDirector({ seed: 3 });
    falsy(dir.enabled, 'до старта не работает');
    eq(dir.tick(10, { loot: 0 }), 'spare', 'до старта фаза не менялась');
    dir.start();
    truthy(dir.enabled);
    eq(dir.phase, 'spare');
    dir.tick(1, { loot: 0 });
    dir.tick(5, { loot: 0 });
    eq(dir.phase, 'spare', 'мало времени и пустой рюкзак — щадит');
    // Рюкзак набит — давит.
    for (let i = 0; i < 3; ++i) dir.tick(5, { loot: 1200 });
    eq(dir.phase, 'press');
    eq(dir.knobs.focus, 0.7, 'в давлении фокус на игроке');
    eq(dir.knobs.mercy, 0);
});

test('режиссёр: долгий рейд с полным рюкзаком давит', () => {
    const dir = createDirector({ seed: 1 });
    dir.start();
    for (let i = 0; i < 80; ++i) dir.tick(5, { loot: 500 });
    eq(dir.phase, 'press', 'время вышло и рюкзак приличный');
    const mid = createDirector({ seed: 1 });
    mid.start();
    for (let i = 0; i < 80; ++i) mid.tick(5, { loot: 100 });
    eq(mid.phase, 'even', 'бедного не давят даже поздно');
});

test('режиссёр: настройки по фазам', () => {
    eq(knobsFor('spare').mercy, 0.6);
    eq(knobsFor('spare').let_win, 0.4);
    eq(knobsFor('even').let_win, 0);
    eq(knobsFor('press').mercy, 0);
    eq(PHASES.join(','), 'spare,even,press');
});

test('режиссёр: загонщик идёт к слабому и не добивает раненого', () => {
    const enemies = [
        { id: 'strong', alive: true, fighting: false, kit: { damage: 40, fireRate: 0.1, parts: 2 }, pos: 10 },
        { id: 'weak', alive: true, fighting: false, kit: { damage: 10, fireRate: 0.5, parts: 0 }, pos: 20 },
        { id: 'busy', alive: true, fighting: true, kit: {}, pos: 30 },
        { id: 'dead', alive: false, kit: {}, pos: 40 },
        { id: 'mad', alive: true, mad: true, kit: {}, pos: 50 },
    ];
    const pick = pickHunter(enemies, new Map(), 100);
    eq(pick.id, 'weak', 'самый слабый и свободный');
    truthy(kitScore({ damage: 40, fireRate: 0.1, parts: 2 }) > kitScore({ damage: 10, fireRate: 0.5 }),
           'сильный ствол — выше очко');
    eq(kitScore(null), 0);
    eq(kitScore({}), 0);
    // Еле живого не травят.
    const dir = createDirector({ seed: 2 });
    dir.start();
    for (let i = 0; i < 60; ++i) dir.tick(5, { loot: 2000, playerHp: 0.2, enemies });
    eq(dir.hunts, 0, 'игрок при смерти — загонщиков нет');
    const dir2 = createDirector({ seed: 2 });
    dir2.start();
    for (let i = 0; i < 60; ++i) dir2.tick(5, { loot: 2000, playerHp: 1, enemies });
    truthy(dir2.hunts > 0, `загонщики пошли: ${dir2.hunts}`);
    truthy(dir2.assignments.length > 0, 'есть назначения');
});

test('режиссёр: назначения истекают, objectiveFor отдаёт цель', () => {
    const enemies = [{ id: 'weak', alive: true, kit: {}, pos: 20 }];
    const dir = createDirector({ seed: 4, huntTtl: 10, tick: 4 });
    dir.start();
    for (let i = 0; i < 5; ++i) dir.tick(5, { loot: 2000, playerHp: 1, enemies });
    truthy(dir.hunts > 0, 'загонщик назначен');
    const id = dir.assignments[0];
    const obj = dir.objectiveFor(id);
    eq(obj.score, 0.62, 'цель тихая');
    truthy(obj.pos !== undefined, 'позиция есть');
    eq(dir.objectiveFor('нет-такого').pos, undefined, 'чужому задания нет');
    // Через TTL задание снимается.
    for (let i = 0; i < 6; ++i) dir.tick(5, { loot: 0, playerHp: 1, enemies });
    eq(dir.assignments.length, 0, 'просроченные сняты');
});

test('режиссёр: save/load и stop', () => {
    const dir = createDirector({ seed: 5 });
    dir.start();
    for (let i = 0; i < 40; ++i) dir.tick(5, { loot: 2000, playerHp: 1, enemies: [{ id: 'a', alive: true, kit: {}, pos: 1 }] });
    const data = JSON.parse(JSON.stringify(dir.save()));
    const restored = createDirector({ seed: 5 }).load(data);
    eq(restored.phase, dir.phase);
    eq(restored.hunts, dir.hunts);
    eq(restored.assignments.length, dir.assignments.length);
    restored.stop();
    falsy(restored.enabled);
    const before = restored.phase;
    restored.tick(10, { loot: 5000 });
    eq(restored.phase, before, 'после stop фаза не меняется');
});

test('психика детерминирована по сиду', () => {
    const a = createPsyche({ type: 'panicker', seed: 11 });
    const b = createPsyche({ type: 'panicker', seed: 11 });
    for (const m of [a, b]) { m.addStress(1); m.checkBreak(); }
    eq(a.breakState, b.breakState, 'тот же сид — тот же срыв');
    const dirA = createDirector({ seed: 7 });
    const dirB = createDirector({ seed: 7 });
    for (const d of [dirA, dirB]) {
        d.start();
        for (let i = 0; i < 40; ++i) d.tick(5, { loot: 2000, playerHp: 1, enemies: [{ id: 'a', alive: true, kit: {}, pos: 1 }] });
    }
    eq(dirA.hunts, dirB.hunts, 'режиссёр воспроизводим');
});

finish();
