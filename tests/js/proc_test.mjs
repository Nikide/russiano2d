// ===========================================================================
// Юнит-тесты процедурного пиксель-арта (src/highlevel/proc.js) без движка.
//
// Проверяем то, что легко сломать: детерминированность по сиду, палитры и
// рампы, пиксельные примитивы, силуэт по частям, свет, контур, зеркало,
// направления, детали и спрайт-лист.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/proc_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    PALETTES, palette, makeRandom, parseColor, rampColor,
    createCanvas, putPixel, getPixel, opaqueCount, fillRect, fillEllipse,
    normalizeArt, renderArt, applyLight, applyOutline, mirrorCanvas,
    createArtLibrary, BUILDS,
} from '../../src/highlevel/proc.js';

test('parseColor: короткая и полная запись', () => {
    eq(parseColor('#f00').join(','), '255,0,0,255');
    eq(parseColor('#ff0000').join(','), '255,0,0,255');
    eq(parseColor('#00ff0080').join(','), '0,255,0,128');
    eq(parseColor('').join(','), '0,0,0,255', 'пустое — чёрный');
    eq(parseColor('#12345').join(','), '0,0,0,255', 'битая длина — чёрный');
});

test('palette: неизвестная палитра не роняет', () => {
    truthy(palette('city').cloth.length > 0);
    eq(palette('нет-такой'), PALETTES.wasteland, 'запасная палитра');
    eq(palette().cloth.length, PALETTES.wasteland.cloth.length);
    truthy(Object.keys(PALETTES).length >= 3, 'палитр несколько');
});

test('rampColor: шаг рампы и отсечение', () => {
    const ramp = ['#000000', '#808080', '#ffffff'];
    eq(rampColor(ramp, 0)[0], 0);
    eq(rampColor(ramp, 2)[0], 255);
    eq(rampColor(ramp, 9)[0], 255, 'выше рампы — свет');
    eq(rampColor(ramp, -3)[0], 0, 'ниже рампы — тень');
    eq(rampColor(null, 1).length, 4, 'пустая рампа — чёрный');
});

test('makeRandom: сид воспроизводим', () => {
    const a = makeRandom(11);
    const b = makeRandom(11);
    const c = makeRandom(12);
    eq([a.next(), a.next()].join(','), [b.next(), b.next()].join(','));
    truthy(makeRandom(11).next() !== makeRandom(12).next(), 'разные сиды');
});

test('canvas: пиксели, границы, счётчик', () => {
    const canvas = createCanvas(4, 3);
    eq(canvas.w, 4); eq(canvas.h, 3);
    eq(canvas.data.length, 4 * 3 * 4);
    eq(opaqueCount(canvas), 0, 'пустой холст прозрачен');
    truthy(putPixel(canvas, 1, 1, '#ff0000'));
    eq(getPixel(canvas, 1, 1).join(','), '255,0,0,255');
    eq(opaqueCount(canvas), 1);
    falsy(putPixel(canvas, -1, 0, '#fff'), 'за краем не ставится');
    falsy(putPixel(canvas, 4, 0, '#fff'), 'правее тоже');
    eq(getPixel(canvas, 99, 99).join(','), '0,0,0,0', 'за краем — прозрачно');
    eq(createCanvas(0, 0).w, 1, 'нулевой размер поднимается до 1');
});

test('fillRect и fillEllipse заливают нужное', () => {
    const canvas = createCanvas(8, 8);
    fillRect(canvas, 1, 1, 3, 2, '#00ff00');
    eq(opaqueCount(canvas), 6);
    const round = createCanvas(9, 9);
    fillEllipse(round, 4, 4, 4, 4, '#0000ff');
    const inside = opaqueCount(round);
    truthy(inside > 20 && inside < 81, `эллипс не квадрат: ${inside}`);
    eq(getPixel(round, 4, 4)[2], 255, 'центр залит');
    eq(getPixel(round, 0, 0)[3], 0, 'угол пуст');
});

test('normalizeArt: значения по умолчанию и пропорции', () => {
    const art = normalizeArt({ id: 'a' });
    eq(art.w, 16); eq(art.h, 24);
    eq(art.palette, 'wasteland');
    eq(art.dirs, 1);
    eq(art.parts.join(','), 'head,torso,arms,legs');
    truthy(art.proportions, 'пропорции есть');
    eq(art.proportions, BUILDS.normal);
    eq(normalizeArt({ build: 'тяжёлый' }).proportions, BUILDS.normal, 'неизвестное тело — обычное');
    eq(normalizeArt({ build: 'heavy' }).proportions, BUILDS.heavy);
    eq(normalizeArt({ w: 1, h: 1 }).w, 4, 'слишком маленький поднимается');
    eq(normalizeArt(), null);
});

test('renderArt: силуэт внутри холста и не пустой', () => {
    const art = normalizeArt({ id: 'hero', w: 16, h: 24, seed: 7 });
    const canvas = renderArt(art);
    eq(canvas.w, 16); eq(canvas.h, 24);
    const opaque = opaqueCount(canvas);
    truthy(opaque > 30, `силуэт нарисован: ${opaque} пикселей`);
    truthy(opaque < 16 * 24, 'не залит целиком');
    // Углы должны быть пустыми: это силуэт, а не прямоугольник.
    eq(getPixel(canvas, 0, 0)[3], 0, 'левый верхний угол пуст');
    eq(getPixel(canvas, 15, 23)[3], 0, 'правый нижний угол пуст');
    // Есть и голова, и ноги по вертикали.
    let hasTop = false, hasBottom = false;
    for (let x = 0; x < 16; ++x) {
        if (getPixel(canvas, x, 1)[3] > 0) hasTop = true;
        if (getPixel(canvas, x, 22)[3] > 0) hasBottom = true;
    }
    truthy(hasTop, 'верх занят (голова)');
    truthy(hasBottom, 'низ занят (ноги)');
});

test('renderArt: детерминированность по сиду', () => {
    const a = renderArt({ id: 'h', w: 16, h: 24, seed: 3 });
    const b = renderArt({ id: 'h', w: 16, h: 24, seed: 3 });
    const c = renderArt({ id: 'h', w: 16, h: 24, seed: 4 });
    eq(a.data.join(','), b.data.join(','), 'тот же сид — тот же спрайт');
    truthy(a.data.join(',') !== c.data.join(','), 'другой сид — другой спрайт');
});

test('renderArt: части тела можно отключить', () => {
    const full = opaqueCount(renderArt({ id: 'a', w: 16, h: 24, seed: 5, outline: false }));
    const noHead = opaqueCount(renderArt({ id: 'a', w: 16, h: 24, seed: 5, outline: false, parts: ['torso', 'legs'] }));
    truthy(noHead < full, `без головы меньше: ${noHead} < ${full}`);
    const onlyArm = opaqueCount(renderArt({ id: 'a', w: 16, h: 24, seed: 5, outline: false, parts: ['arms'] }));
    truthy(onlyArm > 0 && onlyArm < noHead, `только руки: ${onlyArm}`);
});

test('renderArt: зеркало по нечётному направлению', () => {
    const art = normalizeArt({ id: 'm', w: 16, h: 24, seed: 9, dirs: 2 });
    const front = renderArt(art, 0);
    const back = renderArt(art, 1);
    const mirrored = mirrorCanvas(front);
    eq(back.data.join(','), mirrored.data.join(','), 'нечётное направление — зеркало');
    eq(opaqueCount(back), opaqueCount(front), 'пикселей столько же');
});

test('applyLight: верх светлее, низ темнее', () => {
    const canvas = createCanvas(3, 3);
    fillRect(canvas, 0, 0, 3, 3, [100, 100, 100, 255]);
    applyLight(canvas, PALETTES.wasteland);
    truthy(getPixel(canvas, 1, 0)[0] > 100, 'верхняя кромка светлее');
    truthy(getPixel(canvas, 1, 2)[0] < 100, 'нижняя кромка темнее');
    eq(getPixel(canvas, 1, 1)[0], 100, 'середина не тронута');
});

test('applyOutline: контур вокруг силуэта', () => {
    const canvas = createCanvas(7, 7);
    putPixel(canvas, 3, 3, '#ffffff');
    applyOutline(canvas, PALETTES.wasteland);
    const dark = rampColor(PALETTES.wasteland.dark, 0);
    eq(getPixel(canvas, 3, 2).join(','), dark.join(','), 'сверху контур');
    eq(getPixel(canvas, 2, 3).join(','), dark.join(','), 'слева контур');
    eq(getPixel(canvas, 3, 3).join(','), '255,255,255,255', 'сам пиксель не тронут');
    eq(getPixel(canvas, 0, 0)[3], 0, 'дальше контура пусто');
});

test('renderArt: контур можно выключить', () => {
    const withOutline = opaqueCount(renderArt({ id: 'o', w: 16, h: 24, seed: 2 }));
    const without = opaqueCount(renderArt({ id: 'o', w: 16, h: 24, seed: 2, outline: false }));
    truthy(withOutline > without, `контур добавляет пиксели: ${withOutline} > ${without}`);
});

test('renderArt: пропорции тела меняют силуэт', () => {
    const normal = renderArt({ id: 'b', w: 16, h: 24, seed: 6, build: 'normal', outline: false });
    const heavy = renderArt({ id: 'b', w: 16, h: 24, seed: 6, build: 'heavy', outline: false });
    truthy(normal.data.join(',') !== heavy.data.join(','), 'тяжёлое телосложение шире');
    truthy(opaqueCount(heavy) > opaqueCount(normal), 'тяжёлый больше пикселей');
});

test('renderArt: предмет в руках добавляет пиксели', () => {
    const bare = opaqueCount(renderArt({ id: 'r', w: 16, h: 24, seed: 8, outline: false }));
    const rifle = opaqueCount(renderArt({ id: 'r', w: 16, h: 24, seed: 8, outline: false, hold: 'rifle' }));
    truthy(rifle > bare, `ствол добавляет: ${rifle} > ${bare}`);
});

test('renderArt: детали меняют вид', () => {
    const plain = renderArt({ id: 'g', w: 16, h: 24, seed: 12, outline: false, gear: [] });
    const geared = renderArt({ id: 'g', w: 16, h: 24, seed: 12, outline: false, gear: ['vest', 'gas'] });
    truthy(plain.data.join(',') !== geared.data.join(','), 'разгрузка и противогаз видны');
});

test('renderArt: палитра меняет цвета, но не форму', () => {
    const a = renderArt({ id: 'p', w: 16, h: 24, seed: 4, palette: 'city', outline: false });
    const b = renderArt({ id: 'p', w: 16, h: 24, seed: 4, palette: 'forest', outline: false });
    eq(opaqueCount(a), opaqueCount(b), 'силуэт тот же');
    truthy(a.data.join(',') !== b.data.join(','), 'цвета другие');
});

test('библиотека: define/get/load/remove', () => {
    const lib = createArtLibrary();
    truthy(lib.define({ id: 'hero', w: 16, h: 24 }));
    eq(lib.get('hero').id, 'hero');
    truthy(lib.has('hero'));
    eq(lib.ids().join(','), 'hero');
    eq(lib.get('нет'), null);
    eq(lib.define(null), null, 'без описания не создаётся');
    eq(lib.load([{ id: 'a' }, { id: 'b' }]), 2);
    eq(lib.load({ art: [{ id: 'c' }] }), 1);
    eq(lib.ids().length, 4);
    eq(lib.remove('a'), true);
    eq(lib.clear(), 3);
});

finish();
