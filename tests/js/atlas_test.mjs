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
import { parseAtlas, normalizeFrame, atlasImagePath, verifyAtlas } from '../../src/highlevel/atlas.js';

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

// --- §22: страницы, манифест импорта, проверка данных -----------------------

test('parseAtlas: страницы атласа и page у кадров', () => {
    const data = {
        meta: {
            image: 'p0.png',
            size: { w: 64, h: 32 },
            pages: [{ name: 'ground', image: 'p0.png' }, { name: 'props', image: 'p1.png' }],
            padding: 2,
            extrusion: 1,
        },
        frames: {
            a: { frame: { x: 0, y: 0, w: 16, h: 16 }, page: 'props' },
            b: { frame: { x: 16, y: 0, w: 16, h: 16 } },
        },
    };
    const parsed = parseAtlas(data);
    eq(parsed.meta.pages.length, 2, 'две страницы');
    eq(parsed.meta.pages[1].name, 'props');
    eq(parsed.meta.pages[1].image, 'p1.png');
    eq(parsed.frames[0].page, 1, 'кадр ссылается на страницу по имени');
    eq(parsed.frames[1].page, 0, 'без page кадр на первой странице');
    eq(parsed.meta.padding, 2);
    eq(parsed.meta.extrusion, 1);

    const single = parseAtlas({ frames: { a: { x: 0, y: 0, w: 4, h: 4 } } });
    eq(single.meta.pages.length, 1, 'одностраничный атлас тоже описывает страницу');
});

test('parseAtlas: import-манифест (hash, версия, настройки, зависимости)', () => {
    const parsed = parseAtlas({
        frames: { a: { x: 0, y: 0, w: 8, h: 8 } },
        meta: { import: { version: 2, importer: 'r2d-atlas/1.4', hash: 'abc123',
                          settings: { padding: 2, extrude: 1 }, dependencies: ['raw/hero.ase'] } },
    });
    eq(parsed.meta.import.version, 2);
    eq(parsed.meta.import.importer, 'r2d-atlas/1.4');
    eq(parsed.meta.import.contentHash, 'abc123', 'hash читается и как contentHash');
    eq(parsed.meta.import.settings.padding, 2);
    eq(parsed.meta.import.dependencies.join(), 'raw/hero.ase');
});

test('parseAtlas: повторный разбор одних данных даёт тот же результат', () => {
    const data = {
        frames: { a: { x: 0, y: 0, w: 8, h: 8 }, b: { x: 8, y: 0, w: 8, h: 8 } },
        meta: { frameTags: [{ name: 'run', from: 0, to: 1 }], image: 'a.png' },
    };
    eq(JSON.stringify(parseAtlas(data)), JSON.stringify(parseAtlas(data)),
       'разбор детерминирован');
});

test('verifyAtlas: ловит поворот, выход за страницу, перекрытие и битые теги', () => {
    const bad = verifyAtlas({
        meta: { image: 'a.png', size: { w: 32, h: 32 },
                frameTags: [{ name: 'run', from: 0, to: 5 }] },
        // Свой формат тегов: имя кадра, которого в атласе нет.
        tags: { jump: ['nope'] },
        frames: {
            a: { frame: { x: 0, y: 0, w: 16, h: 16, rotated: true } },
            b: { frame: { x: 10, y: 10, w: 16, h: 16 } },
            c: { frame: { x: 40, y: 0, w: 16, h: 16 } },
        },
    });
    const codes = bad.errors.map((e) => e.code);
    truthy(codes.indexOf('atlas_rotated_frame') >= 0, 'поворот найден: ' + codes.join());
    truthy(codes.indexOf('atlas_frames_overlap') >= 0, 'перекрытие найдено');
    truthy(codes.indexOf('atlas_frame_out_of_page') >= 0, 'выход за страницу найден');
    truthy(codes.indexOf('atlas_tag_frame_missing') >= 0, 'тег на несуществующий кадр найден');
    falsy(bad.ok, 'плохие данные не проходят проверку');

    const good = verifyAtlas({
        meta: { image: 'a.png', size: { w: 64, h: 32 }, padding: 0 },
        frames: { a: { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 },
                  b: { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 100 } },
    });
    truthy(good.ok, 'ровные кадры проходят: ' + JSON.stringify(good.errors));
    // Кадры стоят вплотную и padding не объявлен — это предупреждение о риске
    // протечки, а не ошибка данных.
    eq(good.warnings.length, 1, 'одно замечание: ' + JSON.stringify(good.warnings));
    eq(good.warnings[0].code, 'atlas_no_padding');
    eq(good.frames, 2);
});

test('verifyAtlas: манифест новее поддерживаемого — ошибка, старый импортёр — предупреждение', () => {
    const data = {
        frames: { a: { x: 0, y: 0, w: 8, h: 8, duration: 50 } },
        meta: { image: 'a.png', import: { version: 9, importer: 'old', hash: '' } },
    };
    const r = verifyAtlas(data, { manifestVersion: 2, importer: 'r2d-atlas/2.0' });
    truthy(r.errors.some((e) => e.code === 'atlas_manifest_version'),
           'версия манифеста проверяется');
    truthy(r.warnings.some((w) => w.code === 'atlas_importer_mismatch'),
           'чужой импортёр — предупреждение');
    truthy(r.warnings.some((w) => w.code === 'atlas_manifest_no_hash'),
           'нет hash — предупреждение');
});

test('verifyAtlas: не-степень-двойки — предупреждение, а не ошибка', () => {
    const r = verifyAtlas({
        meta: { image: 'a.png', size: { w: 48, h: 32 }, padding: 4 },
        frames: { a: { frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 100 },
                  b: { frame: { x: 16, y: 0, w: 8, h: 8 }, duration: 100 } },
    });
    truthy(r.ok, 'проверка проходит: ' + JSON.stringify(r.errors));
    truthy(r.warnings.some((w) => w.code === 'atlas_page_not_pot'),
           'POT-политика отмечена предупреждением: ' + JSON.stringify(r.warnings));
});

test('verifyAtlas: маленький padding — предупреждение, а не ошибка', () => {
    const r = verifyAtlas({
        meta: { image: 'a.png', size: { w: 64, h: 16 }, padding: 2 },
        frames: { a: { frame: { x: 0, y: 0, w: 8, h: 8 } }, b: { frame: { x: 8, y: 0, w: 8, h: 8 } } },
    });
    truthy(r.ok, 'проверка проходит');
    truthy(r.warnings.some((w) => w.code === 'atlas_padding_small'),
           'padding 2 при зазоре 0 отмечен');
});

finish();
