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

finish();
