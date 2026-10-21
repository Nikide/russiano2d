// Чистая логика новых правок студий (docs/SDK.md §8): граф рамп Particle Studio,
// ручки ресайза Collision Tools, план зон Audio Tools, hit-test выбора в RmlUi Studio.
// Запуск: ./build/_deps/quickjs-build/qjs tests/js/sdk_studio_curves_test.mjs
import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import * as K from '../../editor/lib/shared/kinds/particles.js';
import { graphBoxPoint, graphBoxT, graphBoxValue, graphPointAt } from '../../sdk/tools/particle-studio.js';
import { shapeHandles, handleHit, resizePatch } from '../../sdk/tools/collision-tools.js';
import { zoneMap, zonePoint, zoneAt } from '../../sdk/tools/audio-tools.js';
import { pickNodeIndex } from '../../sdk/tools/rmlui-studio.js';
import * as M from '../../editor/lib/shared/rml_model.js';

test('rampRange: alpha всегда 0..1, size — до максимума точек', () => {
    eq(JSON.stringify(K.rampRange([{ t: 0, alpha: 0 }, { t: 1, alpha: 1 }], 'alpha')), '[0,1]');
    eq(JSON.stringify(K.rampRange([{ t: 0, size: 4 }, { t: 1, size: 20 }], 'size')), '[0,23]');
    eq(JSON.stringify(K.rampRange([], 'size')), '[0,1]');
});

test('sampleRamp: линейная интерполяция и границы', () => {
    const ramp = [{ t: 0, alpha: 0 }, { t: 1, alpha: 1 }];
    near(K.sampleRamp(ramp, 'alpha', 0.25), 0.25);
    near(K.sampleRamp(ramp, 'alpha', -1), 0);
    near(K.sampleRamp(ramp, 'alpha', 2), 1);
    eq(K.sampleRamp(ramp, 'color', 0.5), null);
    near(K.sampleRamp([{ t: 0.5, size: 7 }], 'size', 0.1), 7);
});

test('addRampPoint: сортировка по t, зажим значения, индекс вставки', () => {
    const r = K.addRampPoint([{ t: 0, alpha: 0 }, { t: 1, alpha: 1 }], 'alpha', 0.5, 2);
    eq(r.points.length, 3);
    eq(r.index, 1);
    eq(r.points[1].t, 0.5);
    eq(r.points[1].alpha, 1, 'alpha зажат в 0..1');
    const lo = K.addRampPoint([], 'size', -1, -5);
    eq(lo.points[0].t, 0);
    eq(lo.points[0].size, 0);
    const c = K.addRampPoint([], 'color', 2, 'red');
    eq(c.points[0].t, 1);
    eq(c.points[0].color, 'red');
    eq(K.addRampPoint([], 'color', 0.5, 'не цвет').points[0].color, '#ffffff');
});

test('addRampPoint: не больше 32 точек', () => {
    const many = [];
    for (let i = 0; i < 32; i++) many.push({ t: i / 32, alpha: i / 32 });
    eq(K.addRampPoint(many, 'alpha', 0.5, 0.5), null);
});

test('removeRampPoint: последняя точка защищена', () => {
    eq(K.removeRampPoint([{ t: 0, alpha: 1 }], 0), null);
    const r = K.removeRampPoint([{ t: 0, alpha: 1 }, { t: 0.5, alpha: 0.5 }, { t: 1, alpha: 0 }], 1);
    eq(r.length, 2);
    eq(r[1].t, 1);
    eq(K.removeRampPoint([{ t: 0, alpha: 1 }], 4), null);
});

test('moveRampPoint: t зажат соседями, значение — диапазоном поля', () => {
    const ramp = [{ t: 0, alpha: 1 }, { t: 0.5, alpha: 0.5 }, { t: 1, alpha: 0 }];
    const moved = K.moveRampPoint(ramp, 'alpha', 1, 0.9, -1);
    eq(moved[1].t, 0.9, 't остался между соседями');
    eq(moved[1].alpha, 0);
    const left = K.moveRampPoint(ramp, 'alpha', 1, -1, 2);
    eq(left[1].t, 0);
    eq(left[1].alpha, 1);
    const c = K.moveRampPoint([{ t: 0, color: '#fff' }, { t: 1, color: '#f00' }], 'color', 0, 0.2, 'x');
    eq(c[0].color, '#fff', 'у цвета меняется только t');
    eq(c[0].t, 0.2);
});

test('nearestRampPoint', () => {
    eq(K.nearestRampPoint([{ t: 0 }, { t: 0.5 }, { t: 1 }], 0.6), 1);
    eq(K.nearestRampPoint([], 0.3), -1);
});

test('graphBoxT/graphBoxPoint/graphBoxValue: проекция и обратное преобразование', () => {
    const box = { x: 100, y: 200, w: 220, h: 110 };
    near(graphBoxT(box, 108), 0);
    near(graphBoxT(box, 312), 1);
    near(graphBoxT(box, 50), 0, 1e-9, 'за левым краем — 0');
    const p = graphBoxPoint(box, 'alpha', 0.5, 0.5, [0, 1]);
    near(p.x, 210);
    near(p.y, 255);
    near(graphBoxValue(box, 'alpha', p.y, [0, 1]), 0.5);
    const c = graphBoxPoint(box, 'color', 0, null, [0, 1]);
    near(c.y, 255, 1e-9, 'цвет — середина полосы');
    eq(graphBoxValue(box, 'color', 255, [0, 1]), null);
});

test('graphPointAt: точка под курсором и допуск', () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    const ramp = [{ t: 0, alpha: 1 }, { t: 1, alpha: 0 }];
    const q = graphBoxPoint(box, 'alpha', 1, 0, [0, 1]);
    eq(graphPointAt(ramp, 'alpha', box, [0, 1], q.x, q.y, 10), 1);
    eq(graphPointAt(ramp, 'alpha', box, [0, 1], q.x + 40, q.y, 10), -1);
});

test('Collision: ручки box и circle и ресайз с сохранением противоположного угла', () => {
    const box = { shape: 'box', x: 100, y: 100, w: 40, h: 20 };
    const hs = shapeHandles(box);
    eq(hs.length, 4);
    eq(hs.map((q) => q.handle).join(','), 'nw,ne,sw,se');
    eq(handleHit(box, 80, 90, 5), 'nw');
    eq(handleHit(box, 80, 95, 1), null);
    eq(handleHit({ shape: 'circle', x: 100, y: 100, radius: 24 }, 100, 100, 30), null, 'центр круга — не ручка');
    eq(handleHit({ shape: 'circle', x: 100, y: 100, radius: 24 }, 124, 100, 5), 'r');
    const patch = resizePatch(box, 'se', 160, 150, 8);
    eq(patch.w, 80);
    eq(patch.h, 64);
    eq(patch.x, 120, 'левый край остался на месте');
    eq(patch.y, 122, 'верхний край остался на месте');
    const tiny = resizePatch(box, 'nw', 121, 111, 8);
    eq(tiny.w, 2);
    eq(tiny.h, 2);
    const circle = { shape: 'circle', x: 50, y: 50, radius: 10 };
    eq(shapeHandles(circle).length, 1);
    eq(resizePatch(circle, 'r', 80, 50, 0).radius, 30);
    eq(resizePatch(circle, 'r', 50, 50, 0).radius, 1, 'радиус не ноль');
    eq(resizePatch(box, 'xx', 0, 0, 0), null);
});

test('Audio: план зон, точка → мир, верхняя зона выигрывает', () => {
    const rect = { x: 0, y: 0, w: 800, h: 600 };
    const zones = [{ rect: [0, 0, 400, 300] }, { rect: [0, 0, 200, 200] }];
    const map = zoneMap(rect, zones);
    truthy(map && map.k > 0);
    const p = zonePoint(map, map.ox + 100 * map.k, map.oy + 100 * map.k);
    near(p.x, 100, 1e-6);
    near(p.y, 100, 1e-6);
    eq(zoneAt(zones, 50, 50), 1, 'маленькая зона нарисована последней');
    eq(zoneAt(zones, 350, 250), 0);
    eq(zoneAt(zones, 700, 500), -1);
    eq(zoneMap(rect, []), null);
});

test('RmlUi: pickNodeIndex берёт самый глубокий элемент с id по layoutRect', () => {
    const parsed = M.parse('<rml><body><div id="outer"><p id="inner">x</p></div><span id="plain">y</span><div>no id</div></body></rml>');
    const boxes = { outer: { x: 10, y: 10, w: 200, h: 100 }, inner: { x: 20, y: 20, w: 80, h: 30 }, plain: { x: 300, y: 300, w: 40, h: 20 } };
    const at = (id) => boxes[id] || null;
    eq(parsed.nodes[pickNodeIndex(parsed.nodes, 25, 25, at)].attrs.filter((a) => a.name === 'id')[0].value, 'inner');
    eq(parsed.nodes[pickNodeIndex(parsed.nodes, 150, 90, at)].attrs.filter((a) => a.name === 'id')[0].value, 'outer');
    eq(pickNodeIndex(parsed.nodes, 500, 500, at), -1);
    eq(pickNodeIndex(parsed.nodes, 0, 0, () => { throw new Error('boom'); }), -1);
});

finish();
