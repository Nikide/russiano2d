// ===========================================================================
// §27. Хот-релоад ассетов: конвейер, граф зависимостей, версии, освобождение.
//
// Тест без движка: ядро `createReloadCore` принимает окружение и адаптеры
// видов, поэтому проверяются все стадии (read → validate → prepare → apply),
// откат к last-known-good, топологический порядок, циклы, версии и отложенное
// освобождение handle'ов — на фейковых адаптерах и фейковой ФС.
//
// Запуск: build/_deps/quickjs-build/qjs tests/js/reload_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    createReloadCore, topoOrder, fnv1a, hashHex, ok, fail, builtinAdapters,
    remapNodeSprites,
} from '../../src/highlevel/reload.js';

// --- Фейковое окружение -----------------------------------------------------

function makeEnv(files) {
    const state = { files: files || new Map(), released: [], reports: [], logs: [], frame: 1 };
    const env = {
        log: (m) => state.logs.push(m),
        report: (entry) => state.reports.push(entry),
        frame: () => state.frame,
        now: () => state.frame * 16,
        readText: (path) => (state.files.has(path) ? state.files.get(path) : null),
        readBytes: (path) => {
            const text = state.files.get(path);
            if (text === undefined) return null;
            const out = new Uint8Array(text.length);
            for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
            return out;
        },
        exists: (path) => state.files.has(path),
        nodes: () => [],
        release: (item) => { state.released.push(item); return true; },
        _state: state,
    };
    env.adapters = builtinAdapters();
    return env;
}

/** Простой вид для теста: тело файла публикуется как значение. */
function fakeAdapter(name, hooks) {
    const h = hooks || {};
    return {
        read(asset, env) {
            if (h.read) return h.read(asset, env);
            const text = env.readText(asset.path);
            if (text === null) return fail('R2D_RELOAD_READ', 'нет файла');
            return ok({ text, hash: fnv1a(text) });
        },
        validate(asset, src, env) {
            if (h.validate) return h.validate(asset, src, env);
            return ok();
        },
        prepare(asset, src, env) {
            if (h.prepare) return h.prepare(asset, src, env);
            return ok({ value: src.value.text });
        },
        apply(asset, prep, env) {
            if (h.apply) return h.apply(asset, prep, env);
            return ok({ changed: true, value: prep.value.value });
        },
        _name: name,
    };
}

function coreWith(files, hooks) {
    const env = makeEnv(files);
    env.adapters.set('fake', fakeAdapter('fake', hooks));
    const core = createReloadCore(env);
    return { core, env };
}

// --- Конвейер ---------------------------------------------------------------

test('§27: watch + reload публикует версию и значение', () => {
    const files = new Map([['a.txt', 'v1']]);
    const { core, env } = coreWith(files);
    const asset = core.watch('a', { kind: 'fake', path: 'a.txt' });
    truthy(asset, 'ассет зарегистрирован');
    eq(core.info('a').version, 0);

    const res = core.reload('a');
    eq(res.ok, true);
    eq(res.changed, true);
    eq(res.version, 1);
    eq(core.value('a'), 'v1');
    eq(core.info('a').status, 'ok');
    eq(core.versions('a').length, 1);
    eq(core.stats().applied, 1);
    eq(env._state.reports.length, 0, 'успешная перезагрузка не пишет ошибок');
});

test('§27: неизменившееся содержимое не плодит версии', () => {
    const files = new Map([['a.txt', 'same']]);
    const { core } = coreWith(files);
    core.watch('a', { kind: 'fake', path: 'a.txt' });
    eq(core.reload('a').version, 1);
    const again = core.reload('a');
    eq(again.ok, true);
    eq(again.changed, false);
    eq(again.version, 1, 'версия не выросла');
    eq(core.stats().unchanged, 1);
    eq(core.stats().applied, 1);
});

test('§27: битый источник — failed, last-known-good остаётся', () => {
    const files = new Map([['a.txt', 'v1']]);
    const { core, env } = coreWith(files, {
        read: (asset, e) => (e.readText(asset.path) === null
            ? fail('R2D_RELOAD_READ', 'нет файла')
            : ok({ text: e.readText(asset.path), hash: fnv1a(e.readText(asset.path)) })),
    });
    core.watch('a', { kind: 'fake', path: 'a.txt' });
    core.reload('a');
    eq(core.value('a'), 'v1');

    files.delete('a.txt');
    const bad = core.reload('a');
    eq(bad.ok, false);
    eq(bad.code, 'R2D_RELOAD_READ');
    eq(bad.stage, 'read');
    eq(core.value('a'), 'v1', 'старое значение не тронуто');
    eq(core.info('a').version, 1, 'версия не выросла');
    eq(core.info('a').status, 'failed');
    eq(env._state.reports.length, 1, 'структурная ошибка записана');
    eq(env._state.reports[0].code, 'R2D_RELOAD_READ');
});

test('§27: провал validate/prepare/apply не публикует версию', () => {
    const files = new Map([['a.txt', 'v1']]);
    for (const stage of ['validate', 'prepare', 'apply']) {
        const hooks = {};
        hooks[stage] = () => fail('R2D_RELOAD_' + stage.toUpperCase(), 'отказ на стадии ' + stage);
        const { core } = coreWith(files, hooks);
        core.watch('a', { kind: 'fake', path: 'a.txt' });
        const res = core.reload('a');
        eq(res.ok, false, stage + ': результат failed');
        eq(res.stage, stage, stage + ': стадия названа');
        eq(res.version, 0, stage + ': версия не выросла');
        eq(core.info('a').status, 'failed');
        eq(core.graph().nodes[0].version, 0);
    }
});

test('§27: R2D_RELOAD_PARSE на битом JSON (ошибка не роняет игру)', () => {
    const files = new Map([['d.json', '{ это не json']]);
    const { core, env } = coreWith(files);
    core.watch('d', { kind: 'json', path: 'd.json' });
    const res = core.reload('d');
    eq(res.ok, false);
    eq(res.code, 'R2D_RELOAD_PARSE');
    eq(core.value('d'), null);
    // Ядро живо: следующий ресурс грузится нормально.
    files.set('ok.txt', 'fine');
    core.watch('o', { kind: 'fake', path: 'ok.txt' });
    eq(core.reload('o').ok, true);
    truthy(env._state.reports.some((r) => r.code === 'R2D_RELOAD_PARSE'));
});

// --- Граф зависимостей ------------------------------------------------------

test('§27: зависимости применяются раньше зависимых', () => {
    const files = new Map([['page.txt', 'p1'], ['atlas.txt', 'a1'], ['clip.txt', 'c1']]);
    const { core } = coreWith(files);
    core.watch('page', { kind: 'fake', path: 'page.txt' });
    core.watch('atlas', { kind: 'fake', path: 'atlas.txt', deps: ['page'] });
    core.watch('clip', { kind: 'fake', path: 'clip.txt', deps: ['atlas'] });

    const res = core.reload('clip', { deps: true });
    eq(res.ok, true);
    const order = res.deps.filter((d) => d.ok).map((d) => d.name);
    eq(order.join(','), 'page,atlas', 'сначала страница, потом атлас');
    eq(core.value('page'), 'p1');
    eq(core.value('atlas'), 'a1');
    eq(core.value('clip'), 'c1');
    const g = core.graph();
    eq(g.edges.length, 2);
    eq(g.cycles.length, 0);
});

test('§27: цикл зависимостей — явная ошибка, а не зависание', () => {
    const files = new Map([['a.txt', 'a'], ['b.txt', 'b']]);
    const { core } = coreWith(files);
    core.watch('a', { kind: 'fake', path: 'a.txt', deps: ['b'] });
    core.watch('b', { kind: 'fake', path: 'b.txt', deps: ['a'] });
    const res = core.reload('a');
    eq(res.ok, false);
    eq(res.code, 'R2D_RELOAD_CYCLE');
    truthy(core.graph().cycles.length >= 1);

    const pure = topoOrder(core.assets, []);
    truthy(pure.cycles.length >= 1);
    eq(pure.order.length, 0, 'циклические узлы не попадают в порядок');
    eq(pure.cyclic.sort().join(','), 'a,b');
});

test('§27: отказ зависимости виден, но не портит свою версию', () => {
    const files = new Map([['dep.txt', 'd1'], ['main.txt', 'm1']]);
    const { core } = coreWith(files, {
        read: (asset, env) => {
            if (asset.name === 'dep') return fail('R2D_RELOAD_READ', 'нет страницы атласа');
            const text = env.readText(asset.path);
            return text === null ? fail('R2D_RELOAD_READ', 'нет файла') : ok({ text, hash: fnv1a(text) });
        },
    });
    core.watch('dep', { kind: 'fake', path: 'dep.txt' });
    core.watch('main', { kind: 'fake', path: 'main.txt', deps: ['dep'] });
    const res = core.reload('main', { deps: true });
    eq(res.ok, true, 'свои данные применяются');
    eq(res.version, 1);
    eq(res.deps.length, 1);
    eq(res.deps[0].ok, false, 'отказ зависимости виден в результате');
    eq(res.deps[0].code, 'R2D_RELOAD_READ');
});

test('§27: poll возвращает только изменившееся и упавшее', () => {
    const files = new Map([['a.txt', 'a1'], ['b.txt', 'b1']]);
    const { core } = coreWith(files);
    core.watch('a', { kind: 'fake', path: 'a.txt' });
    core.watch('b', { kind: 'fake', path: 'b.txt' });
    core.poll();
    files.set('a.txt', 'a2');
    const p = core.poll();
    eq(p.total, 2);
    eq(p.applied, 1, 'изменился только a');
    eq(p.results.length, 1);
    eq(p.results[0].name, 'a');
});

// --- Отложенное освобождение ------------------------------------------------

test('§27: handle освобождается на СЛЕДУЮЩЕМ кадре, не в кадре замены', () => {
    const { core, env } = coreWith(new Map());
    env._state.frame = 10;
    core.retire({ kind: 'texture', handle: 7, name: 'tex' });
    eq(core.listPending().length, 1);

    eq(core.flush(10).length, 0, 'в своём кадре ничего не освобождается');
    eq(core.listPending().length, 1);
    eq(env._state.released.length, 0);

    env._state.frame = 11;
    core.retire({ kind: 'texture', handle: 8, name: 'tex2' });
    const released = core.flush(11);
    eq(released.length, 1, 'через кадр освобождается только handle кадра 10');
    eq(released[0].handle, 7);
    eq(core.listPending().length, 1, 'handle кадра 11 ещё ждёт');

    env._state.frame = 12;
    eq(core.flush(12).length, 1);
    eq(core.listPending().length, 0);
    eq(env._state.released.map((r) => r.handle).join(','), '7,8');
    eq(core.stats().retired, 2);
});

test('§27: retire без handle — не ошибка и не растёт очередь', () => {
    const { core } = coreWith(new Map());
    eq(core.retire({ kind: 'texture', handle: null }), false);
    eq(core.listPending().length, 0);
});

// --- Перепривязка спрайтов --------------------------------------------------

test('§27: устаревшие frame ID перепривязываются по имени', () => {
    const nodes = [
        { sprite: 5, frames: null },
        { sprite: 6, frames: [5, 6, 99] },
        { sprite: 99 },
        { removed: true, sprite: 5 },
    ];
    const map = new Map([[5, 105], [6, 106]]);
    const remapped = remapNodeSprites(nodes, map);
    eq(remapped, 2, 'оба узла со старыми кадрами поправлены');
    eq(nodes[0].sprite, 105);
    eq(nodes[1].frames.join(','), '105,106,99');
    eq(nodes[2].sprite, 99, 'чужой спрайт не тронут');
    eq(nodes[3].sprite, 5, 'удалённый узел не тронут');
});

// --- Версии и подписи -------------------------------------------------------

test('§27: подпись содержимого стабильна и чувствительна к правке', () => {
    eq(fnv1a('abc'), fnv1a('abc'));
    truthy(fnv1a('abc') !== fnv1a('abd'));
    eq(hashHex(0x0f).length, 8);
    const bytes = new Uint8Array([1, 2, 3]);
    eq(fnv1a(bytes), fnv1a(new Uint8Array([1, 2, 3])));
    truthy(fnv1a(bytes) !== fnv1a(new Uint8Array([1, 2, 4])));
});

test('§27: события applied/failed приходят подписчику', () => {
    const files = new Map([['a.txt', 'v1']]);
    const { core } = coreWith(files);
    const events = [];
    core.on('applied', (r) => events.push('applied:' + r.name));
    core.on('failed', (r) => events.push('failed:' + r.name + ':' + r.code));
    core.watch('a', { kind: 'fake', path: 'a.txt' });
    core.reload('a');
    files.delete('a.txt');
    core.reload('a');
    eq(events.join('|'), 'applied:a|failed:a:R2D_RELOAD_READ');
    core.off('applied');
    core.reload('a');
    eq(events.filter((e) => e.startsWith('applied')).length, 1,
       'после off подписка applied не срабатывает');
    eq(events.filter((e) => e.startsWith('failed')).length, 2,
       'подписка failed осталась');
});

test('§27: неизвестный ассет/вид — понятная ошибка, не исключение', () => {
    const { core } = coreWith(new Map());
    const no_asset = core.reload('нет-такого');
    eq(no_asset.ok, false);
    eq(no_asset.code, 'R2D_RELOAD_MISSING_DEP');
    const bad_kind = core.watch('x', { kind: 'нет-вида', path: 'x' });
    eq(bad_kind, null);
    core.watch('y', { kind: 'fake', path: 'y' });
    core.assets.get('y').kind = 'чужой';
    const res = core.reload('y');
    eq(res.ok, false);
    eq(res.code, 'R2D_RELOAD_ADAPTER');
});

finish();
