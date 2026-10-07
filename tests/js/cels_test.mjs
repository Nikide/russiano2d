// ===========================================================================
// Юнит-тесты графа кадров (src/highlevel/cels.js) без движка.
//
// Проверяем то, что легко сломать: выбор узла по водителю (точный, доля,
// автоинкремент), объединение водителей узлов, зеркало, fps, путь решения,
// защиту от цикла и сейв.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/cels_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    parseGraph, parseNode, normalizeDriver, resolveIndex,
    createCelRuntime, createCelLibrary,
} from '../../src/highlevel/cels.js';

function heroGraph() {
    return {
        fps: 0,
        drivers: { x: 0, grounded: 1, hurt: 0, time: 0 },
        mirrorDriver: 'x',
        root: {
            type: 'switch', driver: 'hurt',
            nodes: [
                {
                    type: 'switch', driver: 'grounded',
                    nodes: [
                        {
                            type: 'switch', driver: { name: 'x', percentage: true },
                            nodes: [
                                { type: 'anim', cels: ['idle_0', 'idle_1'], driver: 'time', auto: true },
                                { type: 'anim', cels: ['run_0', 'run_1'], driver: 'time', auto: true },
                                { type: 'anim', cels: ['run_0', 'run_1'], driver: 'time', auto: true },
                            ],
                        },
                        { type: 'anim', cels: ['jump_0'] },
                    ],
                },
                { type: 'cel', cel: 'hurt_0' },
            ],
        },
    };
}

test('normalizeDriver: строка, имя и режимы', () => {
    eq(normalizeDriver('time').name, 'time');
    eq(normalizeDriver('time').auto, false);
    eq(normalizeDriver({ name: 'x', percentage: true }).percentage, true);
    fn: {
        const d = normalizeDriver({ name: 'x', auto: true });
        eq(d.auto, true);
    }
    eq(normalizeDriver(''), null);
    eq(normalizeDriver(null), null);
});

test('parseNode: краткие формы и виды узлов', () => {
    eq(parseNode('idle_0').type, 'cel');
    eq(parseNode('idle_0').cel, 'idle_0');
    eq(parseNode({ cels: ['a', 'b'] }).type, 'anim');
    eq(parseNode({ nodes: [{ cel: 'x' }] }).type, 'switch');
    eq(parseNode({ type: 'override', cel: 'x' }).type, 'override');
    eq(parseNode({ type: 'termination' }).type, 'termination');
    eq(parseNode(['a', 'b']).nodes.length, 2, 'массив — это switch');
    // Пустой switch не должен рушить решение.
    eq(parseNode({ nodes: [] }).nodes[0].type, 'termination');
    eq(parseNode({ cels: [] }).cels[0], '');
});

test('parseGraph: водители, fps и корень', () => {
    const g = parseGraph(heroGraph());
    eq(g.fps, 0);
    eq(g.drivers.hurt, 0);
    eq(g.root.type, 'switch');
    eq(parseGraph(null).root.type, 'termination');
    const short = parseGraph({ cels: ['a'] });
    eq(short.root.type, 'anim', 'граф без root читается как узел');
});

test('resolveIndex: точное значение, доля и автоинкремент', () => {
    const state = { values: { x: 3, f: 0.5 } };
    eq(resolveIndex(state, { name: 'x' }, 4, null), 3);
    eq(resolveIndex({ values: { x: 9 } }, { name: 'x' }, 4, null), 1, 'по модулю');
    eq(resolveIndex({ values: { x: -1 } }, { name: 'x' }, 4, null), 3, 'отрицательное по кругу');
    eq(resolveIndex(state, { name: 'f', percentage: true }, 4, null), 2, 'доля в индекс');
    eq(resolveIndex({ values: { f: 1 } }, { name: 'f', percentage: true }, 4, null), 3, 'доля 1 — последний');
    eq(resolveIndex(state, null, 4, null), 0, 'без водителя — первый');
    // Автоинкремент: следующее состояние получает +1.
    const next = { values: {} };
    eq(resolveIndex({ values: { t: 1 } }, { name: 't', auto: true }, 3, next), 1);
    eq(next.values.t, 2);
    const next2 = { values: {} };
    resolveIndex({ values: { t: 2 } }, { name: 't', auto: true }, 3, next2);
    eq(next2.values.t, 0, 'по кругу');
});

test('граф: switch выбирает ветку по водителю', () => {
    const rt = createCelRuntime({ graph: parseGraph(heroGraph()) });
    // Начальные водители графа: grounded = 1 — значит персонаж «в воздухе».
    rt.resolve();
    eq(rt.cel(), 'jump_0', 'по начальным водителям — прыжок');
    // Приземлились и стоим: доля x = 0 даёт первую ветку (стояние).
    rt.state({ hurt: 0, grounded: 0, x: 0 });
    rt.resolve();
    eq(rt.cel(), 'idle_0');
    rt.state({ x: 0.6 });
    rt.resolve();
    eq(rt.cel(), 'run_0', 'доля 0.6 — средняя ветка (бег)');
    rt.state({ grounded: 1 });
    rt.resolve();
    eq(rt.cel(), 'jump_0', 'в воздухе — прыжок');
    rt.state({ grounded: 0, hurt: 1 });
    rt.resolve();
    eq(rt.cel(), 'hurt_0', 'урон перебивает всё');
});

test('граф: водители узла применяются до выбора', () => {
    const graph = parseGraph({
        drivers: { mode: 0 },
        root: {
            type: 'switch', driver: 'mode',
            nodes: [
                { type: 'switch', driver: 'local', setDrivers: { local: 1 },
                  nodes: [{ cel: 'a' }, { cel: 'b' }] },
                { cel: 'c' },
            ],
        },
    });
    const rt = createCelRuntime({ graph });
    rt.resolve();
    eq(rt.cel(), 'b', 'водитель узла перебил внешний local=0');
});

test('граф: автоинкремент перебирает кадры', () => {
    const graph = parseGraph({
        drivers: { t: 0 },
        root: { type: 'anim', cels: ['a', 'b', 'c'], driver: { name: 't', auto: true } },
    });
    const rt = createCelRuntime({ graph });
    const seen = [];
    for (let i = 0; i < 4; ++i) { rt.resolve(); seen.push(rt.cel()); }
    eq(seen.join(','), 'a,b,c,a', 'кадры идут по кругу');
});

test('граф: зеркало и путь решения', () => {
    const graph = parseGraph({
        root: { type: 'override', cel: 'frame_0', mirror: true },
    });
    const rt = createCelRuntime({ graph });
    rt.resolve();
    eq(rt.cel(), 'frame_0');
    truthy(rt.flip(), 'mirror отдаёт флаг');
    truthy(rt.trace().length > 0, 'путь записан');
    eq(rt.node(), 'frame_0');
});

test('граф: fps ограничивает решение', () => {
    const graph = parseGraph({
        fps: 10,
        root: { type: 'override', cel: 'a' },
    });
    const rt = createCelRuntime({ graph });
    rt.tick(0.05);
    eq(rt.cel(), '', 'первый кадр ещё не наступил');
    rt.tick(0.06);
    eq(rt.cel(), 'a', 'через 0.11 с граф решился');
    eq(rt.steps(), 1);
    rt.tick(0.01);
    eq(rt.steps(), 1, 'внутри кадра анимации решения нет');
});

test('граф: цикл в дереве не вешает решение', () => {
    const root = { type: 'switch', driver: null, nodes: [] };
    root.nodes.push(root);   // замыкание, собранное игрой
    const graph = parseGraph({ root });
    const rt = createCelRuntime({ graph });
    rt.resolve();
    eq(rt.cel(), '', 'без кадра, но без зависания');
});

test('граф: termination не даёт кадра', () => {
    const rt = createCelRuntime({ graph: parseGraph({ root: { type: 'termination' } }) });
    rt.resolve();
    eq(rt.cel(), '');
});

test('set/state: водители видны на следующем шаге', () => {
    const rt = createCelRuntime({ graph: parseGraph({
        drivers: { a: 0, b: 0 },
        root: { type: 'switch', driver: 'a', nodes: [{ cel: 'ноль' }, { cel: 'один' }] },
    }) });
    eq(rt.get('a'), 0);
    rt.set('a', 1);
    rt.resolve();
    eq(rt.cel(), 'один');
    eq(rt.get('a'), 1, 'значение сохранилось');
    rt.state({ a: 0, b: 5 });
    rt.resolve();
    eq(rt.cel(), 'ноль');
    eq(rt.values().b, 5);
});

test('reset: возвращает начальные водители', () => {
    const rt = createCelRuntime({ graph: parseGraph({
        drivers: { a: 0 },
        root: { type: 'switch', driver: 'a', nodes: [{ cel: 'a0' }, { cel: 'a1' }] },
    }) });
    rt.set('a', 1);
    rt.resolve();
    eq(rt.cel(), 'a1');
    rt.reset();
    eq(rt.get('a'), 0);
    eq(rt.steps(), 0);
    rt.resolve();
    eq(rt.cel(), 'a0');
});

test('save/load: водители и кадр переживают запись', () => {
    const rt = createCelRuntime({ graph: parseGraph({
        root: { type: 'anim', cels: ['a', 'b'], driver: { name: 't', auto: true } },
    }) });
    rt.resolve();
    const data = JSON.parse(JSON.stringify(rt.save()));
    eq(data.cel, 'a');
    const restored = createCelRuntime({ graph: parseGraph({
        root: { type: 'anim', cels: ['a', 'b'], driver: { name: 't', auto: true } },
    }) });
    restored.load(data);
    eq(restored.cel(), 'a');
    eq(restored.steps(), 1);
});

test('parseNode: неизвестный вид читается как кадр', () => {
    const node = parseNode({ type: 'чушь', cel: 'x' });
    eq(node.type, 'cel');
    eq(node.cel, 'x');
});

test('библиотека: define/get/names/load', () => {
    const lib = createCelLibrary();
    truthy(lib.define('hero', heroGraph()));
    eq(lib.names().join(','), 'hero');
    truthy(lib.has('hero'));
    truthy(lib.get('hero').root);
    eq(lib.get('нет'), null);
    eq(lib.define('', {}), null, 'без имени граф не создаётся');
    eq(lib.load({ guard: { root: { cel: 'g' } } }), 1);
    truthy(lib.has('guard'));
    eq(lib.load({ graphs: { foe: { root: { cel: 'f' } } } }), 1);
    truthy(lib.has('foe'));
    eq(lib.remove('hero'), true);
    eq(lib.clear(), 2);
});

finish();
