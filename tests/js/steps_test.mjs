// ===========================================================================
// Юнит-тесты банков звуков, шагов и реплик NPC без движка.
//
// Проверяем то, что легко сломать: выбор файла без повторов, разброс высоты и
// громкости, интервал, накопление пути до шага, материал по псевдониму и выбор
// реплики по психотипу и безумию.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/steps_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { bankFiles, pickBankFile, bankVolume, bankPitch } from '../../src/highlevel/soundbank.js';
import {
    advanceStride, stepVolume, landVolume, barkFits, pickBark,
    STRIDE, RUN_STRIDE, RUN_SPEED, MIN_SPEED,
} from '../../src/highlevel/steps.js';

test('bankFiles: массив, строка и объект', () => {
    eq(bankFiles(['a.wav', 'b.wav']).length, 2);
    eq(bankFiles('a.wav').join(','), 'a.wav');
    eq(bankFiles({ files: ['a.wav'] }).join(','), 'a.wav');
    eq(bankFiles({ files: 'a.wav' }).join(','), 'a.wav');
    eq(bankFiles(null).length, 0);
    eq(bankFiles({}).length, 0);
});

test('pickBankFile: не повторяет последние avoids', () => {
    const files = ['a', 'b', 'c'];
    const history = [];
    const seen = [];
    for (let i = 0; i < 30; ++i) seen.push(pickBankFile(files, history, 1, () => 0));
    for (let i = 1; i < seen.length; ++i) {
        truthy(seen[i] !== seen[i - 1], `шаг ${i}: не повтор предыдущего (${seen[i - 1]} → ${seen[i]})`);
    }
});

test('pickBankFile: avoids больше числа файлов не ломает выбор', () => {
    const files = ['a', 'b'];
    const history = [];
    const got = pickBankFile(files, history, 10, () => 0.9);
    truthy(files.includes(got), `выбран существующий файл: ${got}`);
});

test('pickBankFile: пустой список — null', () => {
    eq(pickBankFile([], [], 1), null);
    eq(pickBankFile(null, [], 1), null);
});

test('bankVolume: число, диапазон и по умолчанию', () => {
    eq(bankVolume({ volume: 0.5 }), 0.5);
    eq(bankVolume({ volume: [0.4, 0.4] }), 0.4);
    const mid = bankVolume({ volume: [0, 1] }, () => 0.5);
    near(mid, 0.5, 1e-9);
    const low = bankVolume({ volume: [0.2, 1] }, () => 0);
    near(low, 0.2, 1e-9);
    eq(bankVolume({}), 1);
    eq(bankVolume({ volume: 'нет' }), 1);
});

test('bankPitch: разброс в обе стороны и диапазон', () => {
    eq(bankPitch({ pitch: 0 }), 1);
    near(bankPitch({ pitch: 0.1 }, () => 0), 0.9, 1e-9, 'минимум разброса');
    near(bankPitch({ pitch: 0.1 }, () => 1), 1.1, 1e-9, 'максимум разброса');
    near(bankPitch({ pitch: [0.5, 1.5] }, () => 0.5), 1.0, 1e-9);
    eq(bankPitch({}), 1);
});

test('advanceStride: шаг через STRIDE пикселей пути', () => {
    const state = { acc: 0 };
    const r1 = advanceStride(state, 100, 0.5);   // 50 px
    eq(r1.step, false);
    const r2 = advanceStride(state, 100, 0.3);   // ещё 30 px — всего 80
    eq(r2.step, true, 'после STRIDE шаг');
    eq(r2.run, false);
    truthy(state.acc < STRIDE, 'остаток пути сохранён');
});

test('advanceStride: бег даёт шаг реже (шаг длиннее)', () => {
    const walk = { acc: 0 };
    advanceStride(walk, RUN_SPEED + 50, 0.5);
    const walk_step = advanceStride(walk, RUN_SPEED + 50, 0.1);
    // При беге и скорости выше RUN_SPEED шаг считается по RUN_STRIDE.
    eq(walk_step.run, true);
    truthy(RUN_STRIDE > STRIDE, 'беговой шаг длиннее');
});

test('advanceStride: медленно — не шаги, а переминание', () => {
    const state = { acc: 40 };
    const r = advanceStride(state, MIN_SPEED - 10, 0.5);
    eq(r.step, false);
    eq(state.acc, 0, 'накопление сбрасывается');
});

test('stepVolume: бег громче ходьбы, присед почти беззвучен', () => {
    const walk = stepVolume(false, false);
    const run = stepVolume(true, false);
    const crouch = stepVolume(false, true);
    truthy(run > walk, 'бег громче');
    truthy(crouch < walk, 'присед тише');
    truthy(walk > 0 && walk < 1, `громкость ходьбы в долях: ${walk.toFixed(3)}`);
});

test('landVolume: растёт со скоростью падения', () => {
    const soft = landVolume(200);
    const hard = landVolume(900);
    truthy(hard > soft, 'жёсткое приземление громче');
    truthy(soft > 0 && hard <= 1, 'в разумных долях');
    eq(landVolume(0), landVolume(0), 'без скорости — стабильно');
});

test('barkFits: психотип и границы безумия', () => {
    truthy(barkFits({ t: 'x' }, 'любой', 0), 'без типов подходит всем');
    truthy(barkFits({ t: 'x', types: ['параноик'] }, 'параноик', 0.5));
    falsy(barkFits({ t: 'x', types: ['параноик'] }, 'ветеран', 0.5));
    truthy(barkFits({ t: 'x', madness_min: 0.5 }, 'любой', 0.7));
    falsy(barkFits({ t: 'x', madness_min: 0.5 }, 'любой', 0.2));
    falsy(barkFits(null, 'любой', 0));
});

test('pickBark: не повторяет недавние и предпочитает свои', () => {
    const lines = [
        { t: 'общее', types: [] },
        { t: 'своё', types: ['параноик'] },
    ];
    const recent = [];
    const first = pickBark(lines, { psychotype: 'параноик', recent, rng: () => 0 });
    eq(first, 'своё', 'своя реплика выбирается чаще');
    const second = pickBark(lines, { psychotype: 'параноик', recent, rng: () => 0 });
    truthy(second !== first, `не повторяет недавнее: ${second}`);
    const third = pickBark(lines, { psychotype: 'параноик', recent, rng: () => 0 });
    eq(third, '', 'когда все недавние — нечего сказать');
});

test('pickBark: без подходящих строк — пустая строка', () => {
    eq(pickBark([{ t: 'x', types: ['ветеран'] }], { psychotype: 'параноик' }), '');
    eq(pickBark([], {}), '');
    eq(pickBark(null, {}), '');
});

finish();
