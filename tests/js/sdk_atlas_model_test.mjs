// ===========================================================================
// Юнит-тест модели атласа (sdk/lib/atlas_model.js): разбор, канонический вид,
// операции, undo/redo, геометрия. Запуск:
//   build/_deps/quickjs-build/qjs tests/js/sdk_atlas_model_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, near, finish } from './_harness.mjs';
import * as m from '../../sdk/lib/atlas_model.js';

const SAMPLE = {
    meta: {
        app: 'r2d-sdk', image: 'hero.png', size: { w: 128, h: 64 },
        frameTags: [{ name: 'idle', from: 0, to: 1, direction: 'forward', loop: true }, { name: 'walk', from: 2, to: 3 }],
        slices: [
            { name: 'hero_0', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 32, h: 32 }, pivot: { x: 16, y: 31 } }] },
            { name: 'hand', color: '#ff0000ff', keys: [{ frame: 0, bounds: { x: 4, y: 4, w: 4, h: 4 }, pivot: { x: 5, y: 5 } }] },
        ],
        custom: { author: 'Нику', license: 'CC0' },
        extraMeta: [1, 2],
    },
    frames: {
        hero_0: { frame: { x: 0, y: 0, w: 32, h: 32 }, duration: 100 },
        hero_1: { frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 100, trimmed: false },
        hero_2: { frame: { x: 64, y: 0, w: 32, h: 32, extra: 1 }, duration: 80 },
        hero_3: { frame: { x: 96, y: 0, w: 32, h: 32 } },
    },
    version: 3,
};

test('parse → serialize даёт канонический текст и он стабилен', () => {
    const doc = m.parseAtlasDoc(SAMPLE);
    const text = m.serializeAtlas(doc);
    const again = m.serializeAtlas(m.parseAtlasDoc(JSON.parse(text)));
    eq(again, text, 'повторная сериализация совпадает побайтно');
    truthy(text.startsWith('{\n  "meta": {\n    "app": "r2d-sdk",'), 'порядок ключей meta');
    truthy(text.includes('"hero_0": {"frame": {"x": 0, "y": 0, "w": 32, "h": 32}, "duration": 100},'), 'кадр в одну строку');
    truthy(text.includes('{"name": "idle", "from": 0, "to": 1, "direction": "forward", "loop": true},'), 'тег в одну строку');
    truthy(text.includes('"custom": {"author": "Нику", "license": "CC0"}'), 'метаданные не экранируют кириллицу');
    truthy(text.includes('"extraMeta": [1, 2]'), 'чужие поля meta сохранены');
    truthy(text.includes('"version": 3'), 'чужие поля корня сохранены');
    truthy(text.includes('"trimmed": false'), 'чужие поля кадра сохранены');
    truthy(text.includes('"extra": 1'), 'чужие поля рамки сохранены');
    truthy(text.endsWith('}\n'), 'файл заканчивается переводом строки');
});

test('пивот кадра читается из слайса, прочие слайсы остаются слайсами', () => {
    const doc = m.parseAtlasDoc(SAMPLE);
    eq(doc.frames[0].pivot.x, 16);
    eq(doc.frames[0].pivot.y, 31);
    eq(doc.frames[1].pivot, null);
    eq(doc.slices.length, 1, 'слайс hand — не пивот кадра');
    eq(doc.slices[0].name, 'hand');
    const text = m.serializeAtlas(doc);
    truthy(text.includes('"pivot": {"x": 16, "y": 31}'));
    truthy(text.includes('"name": "hand", "color": "#ff0000ff"'));
});

test('плоский вид кадров приводится к каноническому', () => {
    const doc = m.parseAtlasDoc({ frames: { a: { x: 0, y: 0, w: 8, h: 8, duration: 50 } }, image: 'a.png' });
    const text = m.serializeAtlas(doc);
    truthy(text.includes('"a": {"frame": {"x": 0, "y": 0, "w": 8, "h": 8}, "duration": 50}'));
    truthy(text.includes('"image": "a.png"'), 'корневой image не теряется');
});

test('parseAtlasDoc отвергает не-атласы с понятным текстом', () => {
    for (const bad of [null, [], { frames: [] }, { frames: { a: { frame: { x: 'x' } } } }, {}]) {
        let msg = null;
        try { m.parseAtlasDoc(bad); } catch (e) { msg = e.message; }
        truthy(msg && msg.length > 5, 'ошибка для ' + JSON.stringify(bad));
    }
});

function fresh() { return m.parseAtlasDoc(JSON.parse(JSON.stringify(SAMPLE))); }

test('addFrame: имя, длительность по соседу, границы картинки', () => {
    const doc = fresh();
    const i = m.addFrame(doc, { x: 0, y: 32, w: 16, h: 16 });
    eq(i, 4);
    eq(doc.frames[4].name, 'hero_4');
    eq(doc.frames[4].duration, 100, 'длительность по умолчанию — как у соседа/100');
    let msg = null;
    try { m.addFrame(doc, { x: 120, y: 0, w: 16, h: 16 }); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('за пределы'), 'за пределами картинки');
    msg = null;
    try { m.addFrame(doc, { x: 0, y: 0, w: 0, h: 5 }); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('не меньше 1'), 'нулевой размер');
    msg = null;
    try { m.addFrame(doc, { x: 0, y: 0, w: 4, h: 4 }, 'hero_0'); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('уже есть'), 'повторное имя');
});

test('removeFrame пересчитывает теги и слайсы', () => {
    const doc = fresh();
    m.removeFrame(doc, 0);                       // до тегов
    eq(doc.tags[0].from, 0); eq(doc.tags[0].to, 0);
    eq(doc.tags[1].from, 1); eq(doc.tags[1].to, 2);
    eq(doc.slices.length, 0, 'ключ слайса hand стоял на удалённом кадре 0 — слайс исчез вместе с ним');
});

test('removeFrame: тег из одного удаляемого кадра исчезает', () => {
    const doc = fresh();
    m.updateTag(doc, 0, { to: 0 });
    m.removeFrame(doc, 0);
    eq(doc.tags.length, 1);
    eq(doc.tags[0].name, 'walk');
});

test('renameFrame, setRect, setPivot, setDuration, метаданные', () => {
    const doc = fresh();
    m.renameFrame(doc, 1, 'run_1');
    eq(doc.frames[1].name, 'run_1');
    let msg = null;
    try { m.renameFrame(doc, 1, 'hero_0'); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('уже есть'));
    m.setRect(doc, 1, { x: 33, y: 1, w: 30, h: 30 });
    eq(doc.frames[1].x, 33);
    m.setPivot(doc, 1, { x: 15.12345, y: 30 });
    near(doc.frames[1].pivot.x, 15.123, 1e-9, 'пивот округляется до 3 знаков');
    m.setPivot(doc, 1, null);
    eq(doc.frames[1].pivot, null);
    m.setDuration(doc, 1, 250.4);
    eq(doc.frames[1].duration, 250);
    msg = null;
    try { m.setDuration(doc, 1, 0); } catch (e) { msg = e.message; }
    truthy(msg);
    m.setCustom(doc, 'note', 'x');
    eq(doc.custom.note, 'x');
    m.setCustom(doc, 'note', '');
    falsy('note' in doc.custom);
});

test('теги: добавление, проверка диапазона, длительность тега', () => {
    const doc = fresh();
    const i = m.addTag(doc, { name: 'jump', from: 1, to: 3, direction: 'reverse', loop: false });
    eq(doc.tags[i].direction, 'reverse');
    let msg = null;
    try { m.addTag(doc, { name: 'bad', from: 2, to: 9 }); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('вне кадров'));
    msg = null;
    try { m.addTag(doc, { name: 'jump', from: 0, to: 1 }); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('уже есть'));
    m.setTagDuration(doc, 1, 60);
    eq(doc.frames[2].duration, 60); eq(doc.frames[3].duration, 60);
    m.removeTag(doc, i);
    eq(doc.tags.length, 2);
});

test('moveFrame пересчитывает теги по именам и не рвёт их', () => {
    const doc = fresh();
    m.moveFrame(doc, 3, 2);                       // меняет местами два кадра внутри тега walk
    eq(doc.frames[2].name, 'hero_3');
    eq(doc.tags[1].from, 2); eq(doc.tags[1].to, 3);
    let msg = null;
    try { m.moveFrame(doc, 0, 3); } catch (e) { msg = e.message; }
    truthy(msg && msg.includes('разрывает тег'), 'перенос из тега idle в конец рвёт idle');
});

test('tagPlayback повторяет правила рантайма ($.atlas)', () => {
    const doc = fresh();
    const p = m.tagPlayback(doc, 'walk');
    eq(p.frames.join(','), 'hero_2,hero_3');
    eq(p.interval, 80, 'tagInterval — длительность первого кадра');
    near(p.fps, 12.5, 1e-9);
    m.updateTag(doc, 0, { direction: 'reverse' });
    eq(m.tagPlayback(doc, 'idle').frames.join(','), 'hero_1,hero_0');
    eq(m.tagPlayback(doc, 'нет'), null);
});

test('история: undo/redo, откат при ошибке, dirty', () => {
    const doc = fresh();
    const h = m.createHistory(doc);
    falsy(h.dirty());
    h.run('кадр', (d) => m.addFrame(d, { x: 0, y: 32, w: 8, h: 8 }));
    eq(doc.frames.length, 5);
    truthy(h.dirty());
    let msg = null;
    try { h.run('плохо', (d) => { m.renameFrame(d, 0, 'x'); m.addFrame(d, { x: 500, y: 0, w: 8, h: 8 }); }); } catch (e) { msg = e.message; }
    truthy(msg);
    eq(doc.frames[0].name, 'hero_0', 'ошибка откатила и первую правку команды');
    eq(h.labels().undo.length, 1, 'неудачная команда не попала в историю');
    eq(h.undo(), 'кадр');
    eq(doc.frames.length, 4);
    falsy(h.canUndo());
    truthy(h.canRedo());
    eq(h.redo(), 'кадр');
    eq(doc.frames.length, 5);
    h.markSaved();
    falsy(h.dirty());
    h.run('пусто', () => {});
    falsy(h.canRedo());
    eq(h.labels().undo.length, 1, 'пустая команда не пишется');
});

test('геометрия: frameAt, rectFromPoints, clampRect, fitZoom, преобразования вида', () => {
    const doc = fresh();
    eq(m.frameAt(doc, 10, 10), 0);
    eq(m.frameAt(doc, 40, 5), 1);
    eq(m.frameAt(doc, 10, 50), -1);
    m.addFrame(doc, { x: 4, y: 4, w: 8, h: 8 });   // вложенный кадр меньшей площади выигрывает
    eq(m.frameAt(doc, 6, 6), 4);
    const r = m.rectFromPoints(10.2, 20.7, 3.1, 5.5);
    eq(r.x, 3); eq(r.y, 5); eq(r.w, 8); eq(r.h, 16);
    const c = m.clampRect({ x: -5, y: 10, w: 20, h: 100 }, 64, 64);
    eq(c.x, 0); eq(c.w, 15); eq(c.h, 54);
    eq(m.fitZoom(128, 64, 640, 480), 5);
    eq(m.fitZoom(1000, 1000, 500, 500), 0.5);
    eq(m.fitZoom(0, 1, 1, 1), 1);
    const view = { cx: 400, cy: 300, px: 64, py: 32, zoom: 4 };
    const s = m.texToScreen(view, 66, 33);
    eq(s.x, 408); eq(s.y, 304);
    const t = m.screenToTex(view, 408, 304);
    eq(t.x, 66); eq(t.y, 33);
});

test('новый атлас сериализуется и читается обратно', () => {
    const doc = m.newAtlasDoc('sprites/a.png', { w: 16, h: 16 });
    m.addFrame(doc, { x: 0, y: 0, w: 8, h: 8 });
    m.addFrame(doc, { x: 8, y: 0, w: 8, h: 8 });
    m.addTag(doc, { name: 'blink', from: 0, to: 1 });
    const text = m.serializeAtlas(doc);
    const back = m.parseAtlasDoc(JSON.parse(text));
    eq(back.frames.length, 2);
    eq(back.tags[0].name, 'blink');
    eq(back.image, 'sprites/a.png');
    eq(m.serializeAtlas(back), text);
    eq(m.baseName(doc), 'a');
});

test('compact и fmtNum', () => {
    eq(m.compact({ a: [1, 2.5, 'x'], b: null }), '{"a": [1, 2.5, "x"], "b": null}');
    eq(m.fmtNum(0.1 + 0.2), '0.3');
    eq(m.fmtNum(-3), '-3');
    eq(m.fmtNum(NaN), '0');
});

finish();
