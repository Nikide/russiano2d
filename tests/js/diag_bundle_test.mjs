// ===========================================================================
// $.diag.bundle(): диагностический пакет без сети и без выдуманных данных.
//
// Проверяется: путь относительный и проверенный (traversal отклоняется),
// файлы пишутся через $.fs, JSON разбирается, в engine.json есть паспорт
// сборки/сцена/seed/fixed dt/replay, log.txt содержит структурные ошибки,
// а отказ записи возвращает { ok:false, error } вместо исключения.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/diag_bundle_test.mjs
// ===========================================================================

import './_harness.mjs';
import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { engine } from '../../src/highlevel/native.js';

engine.version = '0.1.34-test';
engine.buildId = 'ci-42';
engine.platform = 'macOS';
engine.arch = 'arm64';
engine.gpu = 'metal';
engine.seed = 777;
engine.fixedDt = 1 / 60;
engine.frame = 42;
engine.fps = 60;
engine.time = 2.5;
engine.width = 1280;
engine.height = 720;
engine.renderInfo = () => ({ post: false, passes: 1, draws: 12, targets: [] });
engine.depthInfo = () => ({ enabled: false, meshCmds: 0 });
engine.spriteFilter = () => false;
engine.audio = { activeChannels: () => 0, channelCount: () => 16, count: () => 0 };
engine.bodyCount = () => 0;
engine.limits = () => ({ textures_max: 256, bodies_max: 1024, documents_max: 64 });

const $ = createApi();
$('<rect>', { id: 'hero', x: 1, y: 2 });

// Журнал событий и структурная ошибка — источники пакета.
$.trace.on(true);
$.trace.note('bundle:probe', $('#hero').get(0), { answer: 42 });
$.debug.reportError('$.bundle.test', new Error('синтетическая ошибка'), { code: 'R2D_BUNDLE_TEST' });
// Хвост консоли DevTools (движок свой stderr в JS не хранит).
$.devtools.consoleRun('help');

const written = new Map();
let fail_write = null;
const fakeFs = {
    write(path, text) {
        if (fail_write !== null && path.indexOf(fail_write) >= 0) return false;
        written.set(path, text);
        return true;
    },
    lastError() { return 'синтетический отказ записи'; },
};
const original_fs = $.fs;
$.fs = fakeFs;

test('bundle(): пишет diagnostics/<timestamp>/ и возвращает файлы', () => {
    written.clear();
    fail_write = null;
    const r = $.diag.bundle({ timestamp: '20260102-030405' });
    eq(r.ok, true, 'пакет создан');
    eq(r.path, 'diagnostics/20260102-030405', 'относительный путь');
    eq(r.error, null, 'ошибки нет');
    eq(r.files.length, 6, 'шесть файлов');
    for (const f of r.files) {
        truthy(f.indexOf(r.path + '/') === 0, 'файл внутри каталога: ' + f);
        truthy(written.has(f), 'файл реально записан: ' + f);
    }
    const names = r.files.map((f) => f.split('/').pop()).sort();
    eq(names.join(','), 'README.txt,engine.json,log.txt,replay.json,stats.json,trace.json',
       'состав пакета');

    const eng = JSON.parse(written.get(r.path + '/engine.json'));
    eq(eng.engine.version, '0.1.34-test', 'версия');
    eq(eng.engine.build, 'ci-42', 'сборка');
    eq(eng.engine.platform, 'macOS', 'платформа');
    eq(eng.engine.arch, 'arm64', 'архитектура');
    eq(eng.engine.gpu, 'metal', 'GPU');
    truthy(eng.engine.renderer.info && eng.engine.renderer.info.draws === 12, 'renderer info');
    eq(eng.scene.seed, 777, 'seed');
    eq(eng.scene.fixed_dt, 1 / 60, 'fixed dt');
    eq(eng.scene.frame, 42, 'кадр');
    eq(eng.scene.scene, null, 'сцена не открыта — null, а не выдумка');
    truthy(eng.replay && eng.replay.available === true, 'реплей описан');

    const stats = JSON.parse(written.get(r.path + '/stats.json'));
    truthy(stats.stats && typeof stats.stats.fps === 'number', 'stats');
    truthy(stats.resources && Array.isArray(stats.resources.items), 'ресурсы');
    truthy(stats.limits && typeof stats.limits === 'object', 'лимиты есть');

    const trace = JSON.parse(written.get(r.path + '/trace.json'));
    truthy(trace.total >= 1, 'события журнала');
    truthy(trace.rows.some((x) => x.kind === 'bundle:probe'), 'событие внутри');

    const replay = JSON.parse(written.get(r.path + '/replay.json'));
    eq(replay.available, true, 'replay установлен');
    eq(replay.mode, 'idle', 'режим idle');

    const log = written.get(r.path + '/log.txt');
    truthy(log.indexOf('R2D_BUNDLE_TEST') >= 0, 'структурная ошибка в log.txt');
    truthy(log.indexOf('help') >= 0, 'хвост консоли DevTools в log.txt');

    const readme = written.get(r.path + '/README.txt');
    truthy(readme.indexOf('R2D diagnostic bundle') === 0, 'README');
    truthy(readme.indexOf(r.path) >= 0, 'README называет каталог');
    truthy(readme.indexOf('без сети') >= 0, 'README: без сети');
});

test('bundle(): opts.dir/timestamp нормализуются, traversal отклоняется', () => {
    const before = written.size;
    for (const dir of ['../evil', '/abs', 'a/../b', 'a b', 'a//b', 'C:\\tmp', '~/.ssh']) {
        const r = $.diag.bundle({ dir, timestamp: 'T' });
        eq(r.ok, false, 'dir отклонён: ' + dir);
        eq(r.path, null, 'путь не возвращён: ' + dir);
        eq(r.files.length, 0, 'ничего не записано: ' + dir);
        truthy(r.error.indexOf('opts.dir') >= 0, 'ошибка называет opts.dir');
    }
    for (const timestamp of ['../x', 'a/b', 'a:b', '.hidden', '..', 'a\\b', '']) {
        const r = $.diag.bundle({ timestamp });
        if (timestamp === '') {
            eq(r.ok, true, 'пустой timestamp — текущее время');
            continue;
        }
        eq(r.ok, false, 'timestamp отклонён: ' + timestamp);
        eq(r.path, null, 'путь не возвращён');
        truthy(r.error.indexOf('opts.timestamp') >= 0, 'ошибка называет opts.timestamp');
    }
    eq(written.size > before, true, 'ни один отклонённый путь не писал файлы');
});

test('bundle(): вложенный безопасный каталог и лимиты источников', () => {
    written.clear();
    const r = $.diag.bundle({ dir: 'diag/sub', timestamp: '20260102-030406', trace: 1, errors: 1, log: 1 });
    eq(r.ok, true, 'вложенный каталог');
    eq(r.path, 'diag/sub/20260102-030406', 'путь вложенный');
    const trace = JSON.parse(written.get(r.path + '/trace.json'));
    eq(trace.rows.length, 1, 'trace limit=1');
    const log_lines = written.get(r.path + '/log.txt').split('\n');
    truthy(log_lines.length < 20, 'log ограничен');
});

test('bundle(): отказ записи — структурная ошибка и частичный список', () => {
    written.clear();
    fail_write = 'engine.json';
    const r = $.diag.bundle({ timestamp: 'fail1' });
    eq(r.ok, false, 'отказ виден');
    eq(r.path, 'diagnostics/fail1', 'путь назван');
    truthy(r.error.indexOf('engine.json') >= 0, 'ошибка называет файл');
    truthy(r.files.every((f) => f.indexOf('engine.json') < 0), 'неудавшийся файл не в списке');
    truthy(r.files.length > 0, 'остальные файлы записаны');
    fail_write = null;
});

test('bundle(): нет $.fs — отказ до записи, без исключения', () => {
    $.fs = null;
    $.ctx.fs = null;
    const r = $.diag.bundle({ timestamp: 'nofs' });
    eq(r.ok, false, 'нет fs');
    eq(r.path, null, 'путь null');
    eq(r.files.length, 0, 'файлов нет');
    truthy(r.error.indexOf('$.fs') >= 0, 'ошибка называет $.fs');
    $.fs = original_fs;
});

test('bundle(): мусор в opts не роняет', () => {
    written.clear();
    for (const opts of [null, 'строка', 42, [], { trace: -5, errors: 'x', log: {} }]) {
        const r = $.diag.bundle(opts);
        truthy(r && typeof r.ok === 'boolean', 'ответ структурный');
    }
    truthy(true);
});

finish();
