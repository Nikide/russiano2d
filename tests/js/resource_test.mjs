// ===========================================================================
// Юнит-тесты реестра ресурсов ($.resource) без движка.
//
// Сначала — чистые функции (вид по расширению, нормализация описания, ключ
// описания, текст ошибки) и чистое ядро реестра createRegistry с подставным
// загрузчиком: ленивость, кэш по имени, счётчик ссылок, выгрузка, dispose,
// preload. Затем — $.resource поверх заглушек engine и $.fs: текстуры, спрайты,
// листы, звуки, json, text и data.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/resource_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import { installStore } from '../../src/highlevel/store.js';
import {
    installResource, createRegistry, ensureLoaded, acquireEntry, releaseEntry,
    unloadEntry, makeEntry, inferKind, normalizeSpec, specKey, describeSpec,
    errorText, RESOURCE_KINDS,
} from '../../src/highlevel/resource.js';

// --- Файловая система в памяти: $.fs из store.js ходит в engine.fs ----------
const files = new Map();
engine.fs = {
    readText: (path) => (files.has(path) ? files.get(path) : undefined),
    write: (path, text) => { files.set(path, text); return true; },
    exists: (path) => files.has(path),
    remove: (path) => files.delete(path),
    list: () => [],
};

const $ = {};
installStore($);
$.fs = ctx.fs;
installResource($);

// ---------------------------------------------------------------------------
// Описания ресурсов
// ---------------------------------------------------------------------------

test('inferKind: вид ресурса по расширению файла', () => {
    eq(inferKind('assets/tiles.png'), 'texture');
    eq(inferKind('assets/hero.JPG'), 'texture');
    eq(inferKind('sfx/shot.wav'), 'sound');
    eq(inferKind('music/theme.ogg'), 'sound');
    eq(inferKind('data/level.json'), 'json');
    eq(inferKind('data/notes.txt'), 'text');
    eq(inferKind('assets/unknown.bin'), 'texture', 'неизвестное считаем картинкой');
    eq(inferKind(undefined), 'texture');
});

test('normalizeSpec: строка, объект, лист, кадр и данные', () => {
    const path = normalizeSpec('tiles', 'assets/tiles.png');
    eq(path.kind, 'texture');
    eq(path.path, 'assets/tiles.png');
    eq(path.name, 'tiles');

    const sheet = normalizeSpec('hero', { kind: 'sheet', src: 'art/hero.png', cols: 4, rows: 2, cw: 16, ch: 24 });
    eq(sheet.kind, 'sheet');
    eq(sheet.src, 'art/hero.png');
    eq(sheet.cols, 4);
    eq(sheet.rows, 2);
    eq(sheet.cw, 16);

    const sprite = normalizeSpec('coin', { kind: 'sprite', src: 'art/coin.png', x: 16, w: 16, h: 16 });
    eq(sprite.crop, true, 'обрезка замечена');
    eq(sprite.x, 16);
    eq(sprite.h, 16);
    eq(normalizeSpec('whole', { kind: 'sprite', src: 'art/coin.png' }).crop, false);

    const data = normalizeSpec('tuning', { kind: 'data', value: 5 });
    eq(data.value, 5);
    const built = normalizeSpec('tuning2', { kind: 'data', build: () => 1 });
    eq(typeof built.build, 'function');

    eq(normalizeSpec('', 'a.png'), null, 'без имени ресурса нет');
    eq(normalizeSpec('x', { kind: 'sheet', src: 'a.png', cols: 0 }).cols, 1, 'cols не меньше 1');
    eq(normalizeSpec('x', { kind: 'нет-такого', path: 'a.png' }), null);
    eq(normalizeSpec('x', {}), null, 'без пути и без kind описание не собрать');
    eq(normalizeSpec('x', 5), null);
    eq(RESOURCE_KINDS.indexOf('texture') >= 0, true);
});

test('specKey и describeSpec: по чему сравниваем описания и что пишем в лог', () => {
    const a = normalizeSpec('t', 'assets/tiles.png');
    const b = normalizeSpec('t2', 'assets/tiles.png');
    const c = normalizeSpec('t3', 'assets/other.png');
    eq(specKey(a), specKey(b), 'одно и то же описание — один ключ (имя не в счёте)');
    truthy(specKey(a) !== specKey(c));
    eq(describeSpec(a), 'texture assets/tiles.png');
    eq(describeSpec(normalizeSpec('d', { kind: 'data', value: 1 })), 'data');
    const entry = makeEntry(a);
    entry.name = 'tiles';
    truthy(errorText(entry, 'файл не найден').indexOf('"tiles"') > 0);
    truthy(errorText(entry, 'файл не найден').indexOf('assets/tiles.png') > 0);
    truthy(errorText(entry, 'файл не найден').indexOf('файл не найден') > 0);
});

// ---------------------------------------------------------------------------
// Ядро реестра: ленивость, кэш, ссылки, выгрузка
// ---------------------------------------------------------------------------

/** Подставной загрузчик: считает вызовы и умеет «падать» по команде. */
function makeLoader() {
    const state = { calls: [], fail: true, sequence: 0 };
    const loader = (spec) => {
        state.calls.push(spec.name);
        state.sequence++;
        if (state.fail && spec.path === 'bad.png') return { ok: false, error: 'файл bad.png не найден' };
        if (spec.kind === 'data') {
            const value = spec.build ? spec.build(spec) : spec.value;
            return { ok: true, value };
        }
        return { ok: true, value: `${spec.name}#${state.sequence}` };
    };
    return { state, loader };
}

test('реестр: define не грузит, peek грузит лениво и только один раз', () => {
    const { state, loader } = makeLoader();
    const registry = createRegistry(loader, { log: () => {} });
    const entry = registry.define('tiles', 'assets/tiles.png');
    truthy(entry);
    eq(state.calls.length, 0, 'define ничего не загружает');
    eq(registry.stats().defined, 1);
    eq(registry.stats().ready, 0);

    const first = registry.peek('tiles');
    eq(first.ok, true);
    eq(first.loaded, true, 'первый peek загрузил');
    const second = registry.peek('tiles');
    eq(second.loaded, false, 'второй peek взял из кэша');
    eq(state.calls.length, 1);
    eq(registry.stats().loads, 1);
    eq(registry.has('tiles'), true);
    eq(registry.names().join(','), 'tiles');
});

test('реестр: acquire добавляет ссылки, free выгружает на нуле', () => {
    const { state, loader } = makeLoader();
    const registry = createRegistry(loader, { log: () => {} });
    eq(registry.acquire('tex', 'a.png').refs, 1);
    const again = registry.acquire('tex');
    eq(again.refs, 2, 'повторный load — это вторая ссылка');
    eq(state.calls.length, 1, 'но загрузка одна');
    eq(again.value, 'tex#1');

    eq(registry.free('tex').refs, 1);
    eq(registry.free('tex').unloaded, true, 'на нуле ссылок ресурс выгружается');
    eq(registry.stats().refs, 0);
    eq(registry.stats().ready, 0, 'значение забыто, описание осталось');

    const reloaded = registry.acquire('tex');
    eq(reloaded.refs, 1);
    eq(state.calls.length, 2, 'после выгрузки загрузка повторяется');
    eq(reloaded.value, 'tex#2');
    eq(registry.free('tex').refs, 0);
});

test('реестр: упавшая загрузка объясняет причину и повторяется', () => {
    const { state, loader } = makeLoader();
    const registry = createRegistry(loader, { log: () => {} });
    const bad = registry.acquire('broken', 'bad.png');
    eq(bad.ok, false);
    eq(bad.value, null);
    truthy(bad.error.indexOf('"broken"') > 0, bad.error);
    truthy(bad.error.indexOf('bad.png') > 0, bad.error);
    eq(registry.stats().failed, 1);
    eq(registry.error('broken'), bad.error);

    state.fail = false;
    const retry = registry.acquire('broken');
    eq(retry.ok, true, 'следующая попытка снова идёт к загрузчику');
    eq(registry.stats().failed, 0);
    eq(registry.stats().fails, 1, 'число провалов запомнено');
    registry.free('broken');
});

test('реестр: dispose вызывается при выгрузке, его ошибка не ломает free', () => {
    const { loader } = makeLoader();
    const log = [];
    const registry = createRegistry(loader, { log: (m) => log.push(m) });
    const disposed = [];
    const value = { hp: 5 };
    registry.define('tuning', { kind: 'data', value, dispose: (v) => disposed.push(v) });
    registry.acquire('tuning');
    registry.free('tuning');
    eq(disposed.length, 1);
    eq(disposed[0], value, 'dispose получил само значение');

    registry.define('evil', { kind: 'data', value: 1, dispose: () => { throw new Error('бум'); } });
    registry.acquire('evil');
    eq(registry.free('evil').unloaded, true);
    truthy(log.some((m) => m.indexOf('dispose') > 0), 'ошибка dispose попала в журнал: ' + log.join(' | '));
});

test('реестр: повторное описание под именем не перезаписывает первое', () => {
    const { loader } = makeLoader();
    const log = [];
    const registry = createRegistry(loader, { log: (m) => log.push(m) });
    registry.define('same', 'one.png');
    registry.define('same', 'two.png');
    eq(registry.spec('same').path, 'one.png', 'в кэше осталось первое описание');
    truthy(log.some((m) => m.indexOf('уже описан') > 0), log.join(' | '));
    eq(registry.define('', 'x.png'), null);
    truthy(log.some((m) => m.indexOf('define') > 0));
});

test('реестр: preload греет кэш и не держит ссылок', () => {
    const { state, loader } = makeLoader();
    const registry = createRegistry(loader, { log: () => {} });
    registry.define('a', 'a.png');
    registry.define('b', 'b.png');
    registry.define('bad', 'bad.png');
    const res = registry.preload();
    eq(res.loaded, 2);
    eq(res.failed, 1);
    eq(res.total, 3);
    eq(registry.stats().refs, 0, 'preload — не ссылка');
    eq(state.calls.length, 3);
    eq(registry.preload(['a']).loaded, 1);
    eq(state.calls.length, 3, 'уже загруженное не грузится снова');
});

test('реестр: reload, remove, freeAll и clear', () => {
    const { state, loader } = makeLoader();
    const log = [];
    const registry = createRegistry(loader, { log: (m) => log.push(m) });
    registry.acquire('a', 'a.png');
    const before = registry.peek('a').value;
    const after = registry.reload('a').value;
    truthy(before !== after, 'reload вернул новое значение');
    eq(state.calls.length, 2, 'reload не смотрит в кэш');

    registry.acquire('b', 'b.png');
    eq(registry.freeAll(), 2, 'freeAll выгружает готовые ресурсы');
    eq(registry.stats().refs, 0);
    eq(registry.stats().total, 2, 'описания остались');

    registry.acquire('a');
    eq(registry.remove('a'), true, 'remove снимает описание');
    truthy(log.some((m) => m.indexOf('ещё используется') > 0), 'предупредил про ссылки');
    eq(registry.has('a'), false);
    registry.define('c', 'c.png');
    eq(registry.clear(), 2);
    eq(registry.stats().total, 0);
    eq(registry.list().length, 0);
});

test('реестр: неизвестное имя — понятная подсказка, а не падение', () => {
    const log = [];
    const registry = createRegistry(() => ({ ok: true, value: 1 }), { log: (m) => log.push(m) });
    const peeked = registry.peek('нет-такого');
    eq(peeked.ok, false);
    truthy(String(peeked.error).indexOf('не зарегистрирован') > 0, peeked.error);
    const acquired = registry.acquire('тоже-нет');
    truthy(String(acquired.error).indexOf('не описан') > 0, acquired.error);
    truthy(String(acquired.error).indexOf('$.resource.load') > 0, 'подсказываем, что делать');
    eq(registry.free('нет-такого').ok, false);
    eq(registry.error('нет-такого'), null);
    eq(log.length >= 3, true, 'все три случая объяснены в журнале');
});

test('ensureLoaded/acquireEntry/releaseEntry работают и по отдельности', () => {
    const spec = normalizeSpec('one', 'one.png');
    const entry = makeEntry(spec);
    const res = ensureLoaded(entry, () => ({ ok: true, value: 42 }), 7);
    eq(res.value, 42);
    eq(entry.at, 7, 'время загрузки записано');
    eq(acquireEntry(entry, () => ({ ok: false, error: 'не надо' }), 8).value, 42);
    eq(entry.refs, 1);
    eq(releaseEntry(entry, () => {}).unloaded, true);
    eq(unloadEntry(entry, () => {}), false, 'повторная выгрузка — нечего выгружать');
    eq(entry.state, 'defined');
});

// ---------------------------------------------------------------------------
// $.resource поверх заглушек движка и $.fs
// ---------------------------------------------------------------------------

test('$.resource: текстура грузится один раз, free выгружает', () => {
    $.resource.clear();
    const calls = [];
    engine.loadTexture = (path) => { calls.push(path); return 7; };
    engine.textureSize = () => [64, 32];

    eq($.resource.load('tiles', 'assets/tiles.png'), 7);
    eq($.resource.load('tiles'), 7, 'повторный load возвращает тот же id');
    eq(calls.length, 1, 'но не перезагружает текстуру');
    eq($.resource.stats().refs, 2);
    eq($.resource.info('tiles').width, 64);
    eq($.resource.info('tiles').height, 32);
    eq($.resource.info('tiles').state, 'ready');

    eq($.resource.get('tiles'), 7, 'get не добавляет ссылку');
    eq($.resource.stats().refs, 2);
    eq($.resource.free('tiles'), 1);
    eq($.resource.free('tiles'), 0, 'на нуле ссылок значение выгружено');
    eq($.resource.stats().ready, 0);

    eq($.resource.get('tiles'), 7, 'get загрузит снова');
    eq(calls.length, 2);
    eq($.resource.stats().refs, 0, 'и ссылку не удержит');
});

test('$.resource: спрайт-кадр и лист кадров', () => {
    $.resource.clear();
    engine.loadTexture = () => 3;
    engine.createSprite = (tex, x, y, w, h) => 100 + x + y;

    eq($.resource.load('coin', { kind: 'sprite', src: 'art/coin.png', x: 16, w: 16, h: 16 }), 116);
    eq($.resource.info('coin').kind, 'sprite');

    const frames = $.resource.load('hero-sheet', {
        kind: 'sheet', src: 'art/hero.png', cols: 2, rows: 2, cw: 16, ch: 16,
    });
    eq(Array.isArray(frames), true);
    eq(frames.length, 4, 'лист нарезан на 2×2 кадра');
    eq($.resource.info('hero-sheet').frames, 4);
});

test('$.resource: звук, json, text и data', () => {
    $.resource.clear();
    engine.audio = { load: () => 5, duration: () => 1.25 };
    eq($.resource.load('shot', 'sfx/shot.wav'), 5, 'вид sound выведен из расширения');
    eq($.resource.info('shot').kind, 'sound');
    eq($.resource.info('shot').duration, 1.25);
    engine.audio = { load: () => -1 };
    eq($.resource.load('нет-звука', 'sfx/missing.wav'), null);
    truthy(String($.resource.error('нет-звука')).indexOf('не загрузился') > 0, $.resource.error('нет-звука'));
    engine.audio = undefined;

    files.set('data/config.json', '{"speed": 5}');
    files.set('data/notes.txt', 'привет');
    eq($.resource.load('config', 'data/config.json').speed, 5);
    eq($.resource.load('notes', 'data/notes.txt'), 'привет');
    files.set('data/broken.json', '{ это не json');
    eq($.resource.get('broken', 'запас'), 'запас', 'битый JSON не роняет игру');
    $.resource.define('нет-файла', 'data/missing.json');
    eq($.resource.get('нет-файла', 'запас'), 'запас');
    truthy(String($.resource.error('нет-файла')).indexOf('не найден') > 0,
           $.resource.error('нет-файла'));

    eq($.resource.load('tuning', { kind: 'data', value: { hp: 10 } }).hp, 10);
    let built = 0;
    eq($.resource.load('lazy', { kind: 'data', build: () => { built++; return 'ok'; } }), 'ok');
    eq(built, 1);
    eq($.resource.get('lazy'), 'ok');
    eq(built, 1, 'повторный get не пересобирает значение');
});

test('$.resource: list/stats/info/preload/remove/clear', () => {
    $.resource.clear();
    engine.loadTexture = () => 9;
    $.resource.define('a', 'a.png');
    $.resource.define('b', { kind: 'data', value: 1 });
    const pre = $.resource.preload();
    eq(pre.loaded, 2);
    eq(pre.failed, 0);
    eq($.resource.stats().total, 2);
    eq($.resource.stats().ready, 2);
    eq($.resource.stats().refs, 0, 'preload не держит ссылок');
    eq($.resource.stats().kinds.texture, 1);
    eq($.resource.names().join(','), 'a,b');
    eq($.resource.list().length, 2);
    eq($.resource.list()[0].path, 'a.png');
    eq($.resource.has('a'), true);
    eq($.resource.info('нет'), null, 'info неизвестного — null');
    eq($.resource.remove('a'), true);
    eq($.resource.has('a'), false);
    eq($.resource.clear(), 1);
    eq($.resource.stats().total, 0);
});

test('$.resource: неизвестный ресурс и неописанное имя не роняют кадр', () => {
    $.resource.clear();
    eq($.resource.get('нет-такого'), null);
    eq($.resource.get('нет-такого', 'запас'), 'запас');
    eq($.resource.load('нет-такого'), null);
    eq($.resource.free('нет-такого'), -1);
    eq($.resource.reload('нет-такого'), null);
    eq($.resource.remove('нет-такого'), false);
    eq($.resource.list().length, 0);
});

test('$.resource: без $.fs json и text объясняют, чего не хватает', () => {
    $.resource.clear();
    const saved_fs = $.fs;
    const saved_ctx_fs = ctx.fs;
    $.resource.define('config', 'data/config.json');
    $.fs = null;
    ctx.fs = null;
    try {
        eq($.resource.get('config', 'запас'), 'запас');
        truthy(String($.resource.error('config')).indexOf('$.fs') > 0, $.resource.error('config'));
    } finally {
        $.fs = saved_fs;
        ctx.fs = saved_ctx_fs;
    }
});

finish();
