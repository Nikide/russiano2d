// ===========================================================================
// Юнит-тесты $.fs.pickFolder / pickFile / saveFile без движка (qjs).
//
// Нативный диалог (src/dialog.h) заменён заглушкой engine.fs.dialog/dialogPoll:
// проверяем контракт обёртки — разбор ответа, отмену (null), many (массив),
// нормализацию фильтров и структурный отказ R2D_FS_DIALOG_FAILED.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/fs_dialog_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import { installStore, tickFsDialogs } from '../../src/highlevel/store.js';

const opened = [];
let queue = [];
let nextId = 1;
let openFails = null;

engine.fs = {
    readText: () => undefined, write: () => true, exists: () => false, remove: () => false, list: () => [],
    dialog(kind, opts) {
        if (openFails) return { error: openFails };
        const id = nextId++;
        opened.push({ id, kind, opts });
        return { id };
    },
    dialogPoll() { const out = queue; queue = []; return out; },
};

const reported = [];
const $ = { debug: { reportError: (where, message, opts) => reported.push({ where, message, code: opts.code }) } };
installStore($);
const fs = ctx.fs;

function answer(id, paths, error) { queue.push({ id, paths: paths || [], error: error || null }); tickFsDialogs(); }
async function settle(p) { let v, e; try { v = await p; } catch (x) { e = x; } return { v, e }; }

// 1. Папка: путь из ответа.
const p1 = fs.pickFolder({ title: 'Папка', path: '/tmp' });
answer(1, ['/home/me/game']);
const r1 = await settle(p1);
test('pickFolder → путь', () => {
    eq(opened[0].kind, 'folder');
    eq(opened[0].opts.title, 'Папка');
    eq(opened[0].opts.path, '/tmp');
    eq(r1.v, '/home/me/game');
});

// 2. Отмена → null.
const p2 = fs.pickFile();
answer(2, []);
const r2 = await settle(p2);
test('отмена → null', () => { eq(opened[1].kind, 'open'); eq(r2.v, null); truthy(!r2.e); });

// 3. many → массив; фильтры нормализуются.
const p3 = fs.pickFile({ many: true, filters: [{ name: 'Картинки', ext: '.png, jpg' }, { name: 'пусто' }] });
answer(3, ['/a.png', '/b.jpg']);
const r3 = await settle(p3);
test('many → массив, фильтры', () => {
    eq(JSON.stringify(r3.v), JSON.stringify(['/a.png', '/b.jpg']));
    eq(opened[2].opts.filters.length, 1);
    eq(opened[2].opts.filters[0].ext, 'png;jpg');
    eq(opened[2].opts.many, true);
});

// 4. saveFile → путь, файл не пишется.
const p4 = fs.saveFile({ filters: [{ name: 'JSON', ext: 'json' }] });
answer(4, ['/out.json']);
const r4 = await settle(p4);
test('saveFile → путь', () => { eq(opened[3].kind, 'save'); eq(r4.v, '/out.json'); });

// 5. Ошибка нативного окна → reject с кодом и запись в $.debug.
const p5 = fs.pickFolder();
answer(5, [], 'no portal');
const r5 = await settle(p5);
test('ошибка окна → R2D_FS_DIALOG_FAILED', () => {
    eq(r5.e && r5.e.code, 'R2D_FS_DIALOG_FAILED');
    eq(reported[reported.length - 1].code, 'R2D_FS_DIALOG_FAILED');
    eq(reported[reported.length - 1].where, '$.fs.pickFolder');
});

// 6. Окно не открылось вовсе → reject сразу.
openFails = 'нет дисплея';
const r6 = await settle(fs.pickFile());
openFails = null;
test('не открылось → reject', () => { eq(r6.e && r6.e.code, 'R2D_FS_DIALOG_FAILED'); truthy(/нет дисплея/.test(r6.e.message)); });

// 7. Чужие и повторные ответы не ломают насос; тик без ожиданий — no-op.
queue.push({ id: 999, paths: ['/x'], error: null });
tickFsDialogs();
test('без ожиданий тик — no-op', () => { eq(queue.length, 1); });

finish();
