// ===========================================================================
// Веса и начертания шрифтовых лиц (`$.font.load(..., { weight, style })`).
//
// Проверяется JS-половина до сборки движка:
//   * normalizeFontFaceOptions: normal/bold/1..1000 и normal/italic, а мусор
//     даёт ошибку, а не тихую подмену начертания;
//   * `$.font.load(name, path)` без opts остаётся прежним: грузит атлас сцены
//     (engine.loadFont) и дополнительно регистрирует нормальное лицо RmlUi;
//   * opts weight/style уходят в engine.ui.loadFontFace; атлас сцены для
//     не-400/normal не перезагружается (он одноатласный, bold/italic не
//     подделываются);
//   * faces()/families() отдают метаданные явных лиц;
//   * без GUI лицо не регистрируется, а не выдаётся за загруженное.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/font_weight_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { setEngineForTests } from '../../src/highlevel/native.js';
import { ctx } from '../../src/highlevel/core.js';
import {
    installFont, normalizeFontFaceOptions, FONT_WEIGHT_NORMAL, FONT_WEIGHT_BOLD,
} from '../../src/highlevel/font.js';

function makeEngine(opts) {
    const o = opts || {};
    const state = { atlas: [], faces: [], ui_calls: [] };
    const eng = {
        loadFont(family, path) {
            state.atlas.push({ family, path });
            return o.atlas_ok === undefined ? true : o.atlas_ok;
        },
        fontList() { return o.font_list || ['atlas-default']; },
        fontDefault() { return 'atlas-default'; },
        fontStats() { return { glyphs: 0, atlas_w: 0, atlas_h: 0 }; },
    };
    if (o.ui !== false) {
        eng.ui = {
            loadFontFace(path, family, weight, style) {
                state.ui_calls.push({ path, family, weight, style });
                if (o.ui_ok === false) return false;
                state.faces.push({ family, weight, style, path });
                return true;
            },
            fontFaces() {
                return state.faces.map((f) => ({ ...f }));
            },
        };
    }
    return { eng, state };
}

function fresh(opts) {
    const { eng, state } = makeEngine(opts);
    setEngineForTests(eng);
    const api = {};
    const font = installFont(api);
    return { font, state, eng };
}

function captureLog() {
    const logs = [];
    const saved = ctx.log;
    ctx.log = (msg) => logs.push(String(msg));
    return { logs, restore() { ctx.log = saved; } };
}

test('normalizeFontFaceOptions: normal/bold/1..1000, normal/italic', () => {
    eq(normalizeFontFaceOptions().weight, FONT_WEIGHT_NORMAL);
    eq(normalizeFontFaceOptions().style, 'normal');
    eq(normalizeFontFaceOptions({ weight: 'normal' }).weight, 400);
    eq(normalizeFontFaceOptions({ weight: 'bold' }).weight, 700);
    eq(normalizeFontFaceOptions({ weight: 600 }).weight, 600);
    eq(normalizeFontFaceOptions({ weight: '700' }).weight, 700);
    eq(normalizeFontFaceOptions({ weight: 1 }).weight, 1);
    eq(normalizeFontFaceOptions({ weight: 1000 }).weight, 1000);
    eq(normalizeFontFaceOptions({ style: 'Italic' }).style, 'italic');
    eq(normalizeFontFaceOptions({ style: 'normal' }).style, 'normal');
    eq(normalizeFontFaceOptions({ weight: 'bold', style: 'italic' }).error, null);
});

test('normalizeFontFaceOptions: мусор — error, без тихого fallback', () => {
    for (const bad of [0, 1001, 400.5, 'semibold', '0x400', true, [], {}]) {
        truthy(normalizeFontFaceOptions({ weight: bad }).error, 'weight=' + JSON.stringify(bad));
        eq(normalizeFontFaceOptions({ weight: bad }).weight, null);
    }
    for (const bad of ['oblique', 'italics', 1, {}]) {
        truthy(normalizeFontFaceOptions({ style: bad }).error, 'style=' + JSON.stringify(bad));
    }
});

test('load(name, path) без opts: прежний атлас + нормальное лицо RmlUi', () => {
    const { font, state } = fresh();
    eq(font.load('hud', 'assets/fonts/NotoSans-Regular.ttf'), true);
    eq(state.atlas.length, 1, 'атлас сцены загружен');
    eq(state.atlas[0].family, 'hud');
    eq(state.ui_calls.length, 1, 'лицо RmlUi зарегистрировано');
    eq(state.ui_calls[0].weight, 400);
    eq(state.ui_calls[0].style, 'normal');
    eq(font.uploaded().join(','), 'hud');
    const faces = font.faces();
    eq(faces.length, 1);
    eq(faces[0].family, 'hud');
    eq(faces[0].weight, 400);
    eq(faces[0].style, 'normal');
    eq(faces[0].path, 'assets/fonts/NotoSans-Regular.ttf');
    eq(font.families().join(','), 'atlas-default,hud', 'union без дублей');
});

test('load(..., {weight,style}): лицо RmlUi, атлас не подменяется', () => {
    const { font, state } = fresh();
    eq(font.load('hud-bold', 'assets/fonts/NotoSans-Regular.ttf',
                 { weight: 'bold', style: 'italic' }), true);
    eq(state.atlas.length, 0, 'атлас одноатласный — bold/italic в него не льём');
    eq(state.ui_calls.length, 1);
    eq(state.ui_calls[0].family, 'hud-bold');
    eq(state.ui_calls[0].weight, 700);
    eq(state.ui_calls[0].style, 'italic');
    eq(font.uploaded().join(','), 'hud-bold');
    eq(font.faces()[0].weight, 700);
    eq(font.faces()[0].style, 'italic');
    eq(font.families().join(','), 'atlas-default,hud-bold');
});

test('объектная форма load({name,path,weight,style})', () => {
    const { font, state } = fresh();
    eq(font.load({ name: 'obj', path: 'assets/fonts/X.ttf', weight: 600, style: 'normal' }), true);
    eq(state.atlas.length, 0);
    eq(state.ui_calls[0].family, 'obj');
    eq(state.ui_calls[0].weight, 600);
    eq(state.ui_calls[0].style, 'normal');
});

test('неверные opts: false + диагностика, движок не трогали', () => {
    const { font, state } = fresh();
    const cap = captureLog();
    try {
        eq(font.load('bad', 'assets/fonts/X.ttf', { weight: 'fat' }), false);
        eq(font.load('bad', 'assets/fonts/X.ttf', { style: 'oblique' }), false);
        eq(state.atlas.length, 0);
        eq(state.ui_calls.length, 0);
        eq(cap.logs.length, 2, 'по строке на отказ');
        truthy(cap.logs[0].indexOf('weight') >= 0);
        truthy(cap.logs[1].indexOf('style') >= 0);
    } finally {
        cap.restore();
    }
});

test('без GUI: старое load работает, weight/style — честный false', () => {
    const { font } = fresh({ ui: false });
    eq(font.load('hud', 'assets/fonts/X.ttf'), true, 'атлас сцены жив без RmlUi');
    const cap = captureLog();
    try {
        eq(font.load('bold', 'assets/fonts/X.ttf', { weight: 'bold' }), false);
        eq(cap.logs.length, 1);
        truthy(cap.logs[0].indexOf('GUI') >= 0);
    } finally {
        cap.restore();
    }
    eq(font.faces().length, 0, 'без GUI лиц нет');
});

test('атлас не загрузился — старое false, как раньше', () => {
    const { font } = fresh({ atlas_ok: false });
    const cap = captureLog();
    try {
        eq(font.load('nope', 'assets/fonts/X.ttf'), false);
        truthy(cap.logs.length >= 1 && cap.logs[0].indexOf('не удалось') >= 0);
    } finally {
        cap.restore();
    }
});

test('RmlUi отклонил лицо: default load остаётся true (контракт атласа)', () => {
    const { font } = fresh({ ui_ok: false });
    const cap = captureLog();
    try {
        eq(font.load('hud', 'assets/fonts/X.ttf'), true);
        truthy(cap.logs.length >= 1, 'о непринятом лице предупредили');
        truthy(cap.logs[0].indexOf('RmlUi') >= 0);
        eq(font.faces().length, 0);
    } finally {
        cap.restore();
    }
});

finish();
