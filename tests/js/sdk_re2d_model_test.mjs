// ===========================================================================
// Юнит-тест модели Re2DSprite Studio (sdk/lib/re2d_model.js) без движка.
// Запуск: build/_deps/quickjs-build/qjs tests/js/sdk_re2d_model_test.mjs
// ===========================================================================

import * as std from 'qjs:std';
import { test, eq, truthy, falsy, near, finish } from './_harness.mjs';
import * as R from '../../sdk/lib/re2d_model.js';
import { createHistory } from '../../sdk/lib/history.js';

const read = (p) => std.loadFile(p);

test('сохранение без правок не меняет ни байта у реальных файлов демо', () => {
    for (const p of ['demos/rotsprite/russi.character.json', 'demos/rotsprite/templates/animal.character.json',
                     'demos/rotsprite/weapons/ak47.character.json', 'demos/rotsprite/russi.animations.json']) {
        const text = read(p);
        truthy(text && text.length > 100, 'файл прочитан: ' + p);
        const parsed = R.parseCharacter(text);
        eq(R.serializeCharacter(parsed.def, parsed.indent, parsed.newline), text, p + ': роундтрип побайтно');
    }
});

test('detectIndent: 2 пробела по умолчанию, 4, табы', () => {
    eq(R.detectIndent('{"a":1}'), 2);
    eq(R.detectIndent('{\n    "a": 1\n}'), 4);
    eq(R.detectIndent('{\n\t"a": 1\n}'), '\t');
    eq(R.serializeCharacter({ a: [1] }, 4, false), '{\n    "a": [\n        1\n    ]\n}');
});

test('parseCharacter отвергает не объект', () => {
    let msg = null;
    try { R.parseCharacter('[1]'); } catch (e) { msg = e.message; }
    truthy(msg);
    msg = null;
    try { R.parseCharacter('{битый'); } catch (e) { msg = e.message; }
    truthy(msg);
});

const base = () => R.parseCharacter(read('demos/rotsprite/templates/animal.character.json')).def;

test('absolutize делает пути абсолютными и сворачивает ..', () => {
    const d = base();
    d.variants = { costume: { police: '../assets/p.png' } };
    d.equipment = { gun: { model: 'weapons/ak.character.json', socket: 'hand' } };
    const a = R.absolutize(d, '/proj/models');
    eq(a.atlas, '/proj/models/animal.png');
    eq(a.animations, '/proj/models/animal.animations.json');
    eq(a.variants.costume.police, '/proj/assets/p.png');
    eq(a.equipment.gun.model, '/proj/models/weapons/ak.character.json');
    eq(d.atlas, 'animal.png', 'исходный объект не изменён');
    eq(R.absolutize({ atlas: '/x/y.png' }, '/proj').atlas, '/x/y.png', 'абсолютные остаются как есть');
});

test('boneList: глубина вложенности и части кости', () => {
    const d = base();
    const bones = R.boneList(d);
    eq(bones[0].name, 'body');
    eq(bones[0].depth, 0);
    eq(bones[1].depth, 1);
    eq(R.partsOf(d, 'head').map((p) => p.id).join(','), '91');
    eq(R.partsOf(d, 'нет').length, 0);
});

test('операции: pivot, переназначение части, проекция, сокет, стиль', () => {
    const d = base();
    R.setBonePivot(d, 'head', [1, 2, 3], [4, 5, 6]);
    eq(d.rig.bones[1].pivot.join(','), '1,2,3');
    eq(d.rig.bones[1].portraitPivot.join(','), '4,5,6');
    R.setBonePivot(d, 'head', undefined, null);
    falsy('portraitPivot' in d.rig.bones[1], 'portraitPivot убран');
    R.setPartBone(d, 91, 'tail');
    eq(d.rig.parts.find((p) => p.id === 91).bone, 'tail');
    R.setProjection(d, 'bodyScale', 1.5);
    near(d.projection.bodyScale, 1.5);
    R.setStyle(d, 'pixel');
    eq(d.style, 'pixel');
    d.rig.sockets = [{ name: 'hand', bone: 'paw0', point: [0, 0, 0], rotation: [0, 0, 0] }];
    R.setSocket(d, 'hand', { point: [1, 1, 1] });
    eq(d.rig.sockets[0].point.join(','), '1,1,1');
    eq(d.rig.sockets[0].rotation.join(','), '0,0,0', 'нетронутое поле осталось');
});

test('недопустимые правки отвергаются понятно', () => {
    const d = base();
    const bad = [
        () => R.setBonePivot(d, 'призрак', [0, 0, 0]),
        () => R.setBonePivot(d, 'head', [0, 0]),
        () => R.setBonePivot(d, 'head', [0, 0, NaN]),
        () => R.setBonePivot(d, 'head', [0, 0, 1e9]),
        () => R.setPartBone(d, 91, 'призрак'),
        () => R.setPartBone(d, 12345, 'head'),
        () => R.setProjection(d, 'bodyScale', 0),
        () => R.setProjection(d, 'bodyScale', 9),
        () => R.setProjection(d, 'другое', 1),
        () => R.setSocket(d, 'нет', {}),
        () => R.setStyle(d, 'cartoon'),
        () => R.setDefaultMotion(d, 'fly', ['walk']),
    ];
    for (const f of bad) {
        let msg = null;
        try { f(); } catch (e) { msg = e.message; }
        truthy(msg && msg.length > 5, 'должна быть ошибка: ' + f);
    }
});

test('история откатывает неудачную команду целиком', () => {
    const d = base();
    const h = createHistory(d);
    h.run('ок', (x) => R.setBonePivot(x, 'head', [9, 9, 9]));
    let msg = null;
    try { h.run('плохо', (x) => { R.setBonePivot(x, 'head', [1, 1, 1]); R.setPartBone(x, 91, 'призрак'); }); } catch (e) { msg = e.message; }
    truthy(msg);
    eq(d.rig.bones[1].pivot.join(','), '9,9,9', 'первая правка неудачной команды откатилась');
    eq(h.undo(), 'ок');
    eq(d.rig.bones[1].pivot.join(','), '-13,-5,0');
});

test('clipNames, emotionNames, normalizePose', () => {
    eq(R.clipNames({ clips: { a: {}, b: {} } }).join(','), 'a,b');
    eq(R.clipNames(null).length, 0);
    eq(R.emotionNames({ emotions: { happy: {} } }).join(','), 'happy');
    const p = R.normalizePose(200, 99);
    eq(p.yaw, -160); eq(p.pitch, 75);
    eq(R.normalizePose(360, -99).yaw, 0);
    eq(R.normalizePose(-180, 0).yaw, -180);
});

test('sampleAt: попадание в карту и промах', () => {
    const view = { x: 100, y: 50, cell: 3 };
    const hit = R.sampleAt(view, 100 + 3 * 10 + 1, 50 + 3 * 4 + 2);
    eq(hit.mx, 10); eq(hit.my, 4);
    eq(R.sampleAt(view, 99, 60), null);
    eq(R.sampleAt(view, 100 + 3 * 256, 60), null);
    truthy(R.describeSample({ id: 5, bone: 'head', x: 1, y: 2, z: 3, coverage: 255, group: 2 }).includes('head'));
    eq(R.describeSample(null), '—');
});

test('sampleAt с размерами сетки v3', () => {
    const view = { x: 0, y: 0, cell: 2 };
    eq(R.sampleAt(view, 2 * 2047 + 1, 2 * 1535 + 1, 2048, 1536).mx, 2047);
    eq(R.sampleAt(view, 2 * 2048, 10, 2048, 1536), null, 'за правым краем сетки');
    eq(R.sampleAt(view, 10, 2 * 1536, 2048, 1536), null, 'ниже сетки');
});

test('gridScale и brushCells на мусорных входах', () => {
    const bad = R.gridScale(NaN, undefined);
    truthy(Number.isInteger(bad) && bad >= 1 && bad <= 4, 'нечисловые размеры не дают NaN в масштабе');
    eq(R.gridScale(undefined, undefined), 4, 'без размеров — самый крупный допустимый масштаб');
    eq(R.gridScale(0, 0), 4);
    eq(R.gridScale('мусор', 100), R.gridScale(100, 100));
    eq(R.brushCells(3, 3, 1).length, 1, 'без размеров сетки кисть работает по карте v2');
    eq(R.brushCells(300, 3, 1).length, 0, 'за картой v2 клеток нет');
});

test('brushCells: кисть внутри сетки и обрезка по краю', () => {
    eq(R.brushCells(10, 10, 1, 64, 64).length, 1);
    const three = R.brushCells(10, 10, 3, 64, 64);
    eq(three.length, 9);
    eq(three[0].join(','), '9,9');
    eq(three[8].join(','), '11,11');
    eq(R.brushCells(0, 0, 3, 64, 64).length, 4, 'левый верхний угол обрезан');
    eq(R.brushCells(63, 63, 3, 64, 64).length, 4, 'правый нижний угол обрезан');
    const huge = R.brushCells(5, 5, 200, 64, 64);
    truthy(huge.every(([x, y]) => x >= 0 && y >= 0 && x < 64 && y < 64), 'кисть больше сетки не выходит за неё');
    eq(huge.length, 38 * 38, 'кисть обрезана размером сетки 64 и краем');
});

test('strokeRects: мазок в горизонтальные прогоны по рядам', () => {
    eq(R.strokeRects([]).length, 0);
    eq(R.strokeRects(['1,2', '2,2', '3,2', '7,2']).map((r) => r.join(',')).join(' '), '1,2,3,1 7,2,1,1');
    eq(R.strokeRects(['0,0', '0,1']).length, 2, 'вертикальный ряд — два прямоугольника');
    eq(R.strokeRects(['мусор', '4,5']).length, 1, 'нечисловая клетка пропускается');
});

test('parseHexColor и gridScale', () => {
    eq(R.parseHexColor('#ff8040').join(','), '255,128,64');
    eq(R.parseHexColor('ff8040').join(','), '255,128,64');
    eq(R.parseHexColor('#ff80'), null);
    eq(R.parseHexColor('красный'), null);
    eq(R.gridScale(2048, 1536), 1, 'крупная сетка — масштаб 1');
    eq(R.gridScale(256, 256), 4, 'мелкая сетка — до 4');
    eq(R.gridScale(4096, 4096), 1);
});

test('describeTexel: обе трактовки идентификатора и пустой тексель', () => {
    const s = { x: 3, y: 4, live: true, color: [10, 20, 30, 255], position: [1, 2, 3], normal: [0, 0, 1], gloss: 90,
                bones: [{ id: 2, weight: 255, dominant: true, asBone: true, bone: 'head', asPart: false, partBone: null }] };
    const text = R.describeTexel(s);
    truthy(text.includes('head (кость #2)') && text.includes('100%') && text.includes('блеск 90'));
    const part = Object.assign({}, s, { bones: [{ id: 12, weight: 128, dominant: true, asBone: false, bone: null, asPart: true, partBone: 'hipLeft' }] });
    truthy(R.describeTexel(part).includes('часть 12 → hipLeft'));
    truthy(R.describeTexel({ x: 1, y: 1, live: false }).includes('пусто'));
    eq(R.describeTexel(null), '—');
});

finish();
