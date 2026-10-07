// ===========================================================================
// Юнит-тесты разбора атласов (src/highlevel/atlas.js) без движка.
//
// Проверяем то, что легко сломать: три формата JSON, номера кадров в тегах
// Aseprite, обратное направление тега, повёрнутые кадры, путь к картинке.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/atlas_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { parseAtlas, normalizeFrame, atlasImagePath } from '../../src/highlevel/atlas.js';

test('normalizeFrame понимает `frame{}`, плоский кадр и w/h против width/height', () => {
    const a = normalizeFrame('idle_0', { frame: { x: 1, y: 2, w: 3, h: 4 }, duration: 120 });
    eq(a.x, 1); eq(a.y, 2); eq(a.w, 3); eq(a.h, 4);
    eq(a.name, 'idle_0');
    eq(a.duration, 120);
    const b = normalizeFrame('', { x: 5, y: 6, width: 7, height: 8 });
    eq(b.w, 7); eq(b.h, 8);
    eq(normalizeFrame('bad', { frame: { x: 0, y: 0, w: 0, h: 0 } }), null, 'нулевой кадр отброшен');
    eq(normalizeFrame('bad', null), null);
});

test('parseAtlas: Aseprite — объект frames и теги по номерам', () => {
    const data = {
        frames: {
            'hero_0': { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 },
            'hero_1': { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 100 },
            'hero_2': { frame: { x: 32, y: 0, w: 16, h: 16 }, duration: 100 },
        },
        meta: {
            image: 'hero.png',
            size: { w: 48, h: 16 },
            frameTags: [
                { name: 'idle', from: 0, to: 1, direction: 'forward' },
                { name: 'walk', from: 1, to: 2, direction: 'reverse' },
            ],
        },
    };
    const parsed = parseAtlas(data);
    eq(parsed.format, 'aseprite');
    eq(parsed.frames.length, 3);
    eq(parsed.frames[0].name, 'hero_0');
    eq(JSON.stringify(parsed.tags.idle), '["hero_0","hero_1"]');
    eq(JSON.stringify(parsed.tags.walk), '["hero_2","hero_1"]', 'reverse переворачивает список');
    eq(parsed.meta.size.w, 48);
    eq(parsed.meta.image, 'hero.png');
});

test('parseAtlas: TexturePacker — массив с filename', () => {
    const data = {
        frames: [
            { filename: 'run_0.png', frame: { x: 0, y: 0, w: 8, h: 8 } },
            { filename: 'run_1.png', frame: { x: 8, y: 0, w: 8, h: 8 } },
        ],
    };
    const parsed = parseAtlas(data);
    eq(parsed.format, 'array');
    eq(parsed.frames.length, 2);
    eq(parsed.frames[1].name, 'run_1.png');
    eq(parsed.tags && Object.keys(parsed.tags).length, 0);
});

test('parseAtlas: простой свой формат — карта имя → прямоугольник', () => {
    const data = { frames: { coin: { x: 0, y: 0, w: 12, h: 12 }, gem: { x: 12, y: 0, w: 12, h: 12 } } };
    const parsed = parseAtlas(data);
    eq(parsed.format, 'map');
    eq(parsed.frames.map((f) => f.name).join(','), 'coin,gem');
});

test('parseAtlas: теги отдельным полем тоже читаются', () => {
    const data = {
        frames: { a: { x: 0, y: 0, w: 4, h: 4 }, b: { x: 4, y: 0, w: 4, h: 4 } },
        tags: { duo: ['a', 'b'] },
    };
    const parsed = parseAtlas(data);
    eq(JSON.stringify(parsed.tags.duo), '["a","b"]');
});

test('parseAtlas: мусор не роняет разбор', () => {
    eq(parseAtlas(null).frames.length, 0);
    eq(parseAtlas({}).frames.length, 0);
    eq(parseAtlas({ frames: 'нет' }).frames.length, 0);
    eq(parseAtlas({ frames: [null, { frame: { x: -1, y: 0, w: 2, h: 2 } }] }).frames.length, 1);
});

test('atlasImagePath: мета важнее, иначе рядом с JSON', () => {
    eq(atlasImagePath('art/hero.json', { meta: { image: 'hero.png' } }), 'art/hero.png');
    eq(atlasImagePath('art/hero.json', {}), 'art/hero.png');
    eq(atlasImagePath('art/hero.json', { meta: { image: '/abs/hero.png' } }), '/abs/hero.png');
    eq(atlasImagePath('hero.json', null), 'hero.png');
});

// --- слайсы Aseprite: пивоты ---
// В JSON слайса пивот задан АБСОЛЮТНО (в координатах спрайта), а для вращения
// части нужен локальный — от левого верхнего угла слайса. Здесь и проверяем
// оба: ошибка в этом месте выглядит как «персонаж крутится вокруг угла».
test('parseAtlas: слайсы — прямоугольник и пивот', () => {
    const data = {
        frames: { 'a 0.aseprite': { frame: { x: 0, y: 0, w: 16, h: 16 } } },
        meta: {
            size: { w: 48, h: 16 },
            slices: [{
                name: 'hand',
                keys: [
                    { frame: 0, bounds: { x: 0, y: 0, w: 16, h: 16 },
                      pivot: { x: 4, y: 12 } },
                    { frame: 2, bounds: { x: 32, y: 0, w: 16, h: 16 },
                      pivot: { x: 40, y: 8 } },
                ],
            }],
        },
    };
    const p = parseAtlas(data);
    eq(p.slices.hand.length, 2);
    eq(p.slices.hand[0].pivotX, 4);
    eq(p.slices.hand[0].pivotLx, 4);
    eq(p.slices.hand[0].pivotLy, 12);
    // Абсолютный пивот 40 при слайсе с x = 32 даёт локальный 8.
    eq(p.slices.hand[1].pivotLx, 8);
    eq(p.slices.hand[1].pivotLy, 8);
});

test('parseAtlas: пивот по умолчанию — центр слайса', () => {
    const p = parseAtlas({
        frames: { a: { frame: { x: 0, y: 0, w: 10, h: 10 } } },
        meta: { slices: [{ name: 's', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 10, h: 10 } }] }] },
    });
    // ВНИМАНИЕ: p.slices[имя] — МАССИВ ключей по кадрам, а не объект.
    eq(p.slices.s.length, 1);
    eq(p.slices.s[0].pivotLx, 5);
    eq(p.slices.s[0].pivotLy, 5);
});

test('parseAtlas: без slices поле не появляется, мусор пропускается', () => {
    const none = parseAtlas({ frames: { a: { x: 0, y: 0, w: 4, h: 4 } } });
    eq(none.slices, undefined);
    const bad = parseAtlas({
        frames: { a: { x: 0, y: 0, w: 4, h: 4 } },
        meta: { slices: [{ name: '', keys: [] }, { name: 'x', keys: [{ frame: 0 }] }] },
    });
    truthy(!bad.slices || bad.slices.x === undefined);
});

finish();
